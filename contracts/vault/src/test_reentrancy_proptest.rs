//! Property-based reentrancy guard invariants (Issue #2077).
//!
//! The unit tests in `test_reentrancy.rs` verify specific guard scenarios.
//! This module uses proptest to explore random sequences of propose/approve/
//! execute operations and asserts that the reentrancy guard invariants hold
//! in every reachable state:
//!
//! - The in-progress flag for a proposal is never set when that proposal has
//!   already reached a terminal status (Executed / Rejected / Expired /
//!   Cancelled).
//! - After any sequence of operations the guard is never simultaneously set
//!   for more than one proposal (the contract executes proposals one at a time;
//!   concurrent in-progress marks would indicate a guard leak).
//! - A proposal that is blocked by the guard stays in `Approved` status —
//!   the refused re-entrant call must not mutate it.
#![cfg(test)]

use crate::storage;
use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::{ConditionLogic, Priority, ProposalStatus};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Action {
    /// Create a new proposal for `amount` tokens.
    Propose(i128),
    /// Approve the i-th live proposal (index into live_ids, wraps).
    Approve(usize),
    /// Execute the i-th live proposal.
    Execute(usize),
    /// Cancel the i-th live proposal.
    Cancel(usize),
    /// Artificially set the guard for the i-th live proposal to simulate a
    /// mid-execution re-entry scenario, then immediately attempt to execute it
    /// again (must be refused).
    SimulateReentry(usize),
    /// Advance ledger time.
    AdvanceTime(u64),
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => (1i128..=500_000i128).prop_map(Action::Propose),
        3 => (0usize..8).prop_map(Action::Approve),
        2 => (0usize..8).prop_map(Action::Execute),
        1 => (0usize..8).prop_map(Action::Cancel),
        2 => (0usize..8).prop_map(Action::SimulateReentry),
        1 => (0u64..=50_000u64).prop_map(Action::AdvanceTime),
    ]
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// Over a random sequence of propose/approve/execute/cancel operations
    /// (with occasional simulated re-entry attempts), assert that:
    ///
    /// 1. No proposal in a terminal state has its in-progress guard set.
    /// 2. At most one proposal has its in-progress guard set at any point
    ///    (the guard is always cleared before the next operation can proceed,
    ///    because we call operations synchronously in the test env).
    /// 3. A re-entrant execute attempt leaves the proposal in `Approved` status.
    #[test]
    fn reentrancy_guard_invariants(actions in prop_vec(action_strategy(), 1..50)) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _token) = setup(&env);

        // Track all proposal ids created so far.
        let mut live_ids: std::vec::Vec<u64> = std::vec::Vec::new();
        // A second signer is needed: setup gives us threshold=2.
        // We reuse the second signer from setup by generating one and granting Treasurer.
        let signer2 = Address::generate(&env);
        client.set_role(&admin, &signer2, &crate::types::Role::Treasurer);

        let recipient = Address::generate(&env);

        for action in actions {
            match action {
                Action::Propose(amount) => {
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        &admin,
                        &recipient,
                        &client.get_config().token.unwrap_or(
                            // fall back: re-read token from setup (stored in config)
                            Address::generate(&env)
                        ),
                        &amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        live_ids.push(id);
                    }
                }
                Action::Approve(i) => {
                    if let Some(&id) = live_ids.get(i % live_ids.len().max(1)) {
                        let _ = client.try_approve_proposal(&admin, &id);
                        let _ = client.try_approve_proposal(&signer2, &id);
                    }
                }
                Action::Execute(i) => {
                    if let Some(&id) = live_ids.get(i % live_ids.len().max(1)) {
                        let _ = client.try_execute_proposal(&admin, &id);
                    }
                }
                Action::Cancel(i) => {
                    if let Some(&id) = live_ids.get(i % live_ids.len().max(1)) {
                        let _ = client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c"));
                    }
                }
                Action::SimulateReentry(i) => {
                    if let Some(&id) = live_ids.get(i % live_ids.len().max(1)) {
                        let status = client.get_proposal(&id).status;
                        if status == ProposalStatus::Approved {
                            // Set the guard as if we're mid-execution.
                            env.as_contract(&client.address, || {
                                storage::set_proposal_in_progress(&env, id);
                            });
                            // A re-entrant execute must be refused.
                            let result = client.try_execute_proposal(&admin, &id);
                            prop_assert!(
                                result.is_err(),
                                "re-entrant execute of proposal {} must be refused",
                                id
                            );
                            // The proposal must still be Approved (not mutated).
                            prop_assert_eq!(
                                client.get_proposal(&id).status,
                                ProposalStatus::Approved,
                                "proposal {} status must remain Approved after refused re-entry",
                                id
                            );
                            // Clear the guard so subsequent operations are not blocked.
                            env.as_contract(&client.address, || {
                                storage::clear_proposal_in_progress(&env, id);
                            });
                        }
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
            }

            // --- Invariant 1: no terminal proposal has the guard set ---
            for &id in &live_ids {
                let status = client.get_proposal(&id).status;
                let in_progress = env.as_contract(&client.address, || {
                    storage::is_proposal_in_progress(&env, id)
                });
                let is_terminal = matches!(
                    status,
                    ProposalStatus::Executed
                        | ProposalStatus::Rejected
                        | ProposalStatus::Expired
                        | ProposalStatus::Cancelled
                );
                prop_assert!(
                    !(is_terminal && in_progress),
                    "proposal {} has terminal status {:?} but in-progress guard is still set",
                    id, status
                );
            }

            // --- Invariant 2: at most one proposal has the guard set ---
            let guards_set: usize = live_ids.iter().filter(|&&id| {
                env.as_contract(&client.address, || {
                    storage::is_proposal_in_progress(&env, id)
                })
            }).count();
            prop_assert!(
                guards_set <= 1,
                "more than one in-progress guard set simultaneously ({} proposals)",
                guards_set
            );
        }
    }
}
