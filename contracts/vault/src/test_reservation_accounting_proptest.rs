//! Property-based invariants for pending reservation accounting (Issue #2077).
//!
//! The deterministic tests in `test_pending_reservations.rs` cover specific
//! scenarios (budget exhaustion, multi-proposer sharing, day rollover). This
//! module uses proptest to verify the same invariants hold for arbitrary action
//! sequences, including interleaved proposals, cancellations, executions, and
//! time advances from multiple proposers.
//!
//! Invariants checked after every step:
//!
//! 1. `get_daily_spent(today)` ≥ 0 — the counter never underflows.
//! 2. `get_weekly_spent(week)` ≥ 0 — likewise.
//! 3. `get_daily_spent(today)` ≤ daily_limit — the shared cap is never exceeded.
//! 4. `get_weekly_spent(week)` ≤ weekly_limit — likewise.
//! 5. `get_total_reserved(token)` ≤ vault token balance — the vault never
//!    over-promises tokens it does not hold.
//! 6. After cancelling every pending proposal, both spend counters return to
//!    zero (reservations are fully released).
#![cfg(test)]

use crate::storage;
use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::{ConditionLogic, Priority};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::TokenClient,
    Address, Env, Symbol, Vec,
};
use std::collections::VecDeque;

const DAY_SECS: u64 = 86_400;
const WEEK_SECS: u64 = 604_800;
const DAILY_LIMIT: i128 = 5_000_000;
const WEEKLY_LIMIT: i128 = 10_000_000;
const SPENDING_LIMIT: i128 = 2_000_000;

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

/// Three independent proposers — indices 1 and 2 get Treasurer on first use.
#[derive(Clone, Debug)]
enum ProposerIdx { A, B, C }

#[derive(Clone, Debug)]
enum Action {
    Propose { proposer: ProposerIdx, amount: i128 },
    CancelOldest(ProposerIdx),
    ExecuteOldestA,
    AdvanceTime(u64),
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        5 => (prop_oneof![Just(ProposerIdx::A), Just(ProposerIdx::B), Just(ProposerIdx::C)],
              1i128..=(SPENDING_LIMIT * 2))
            .prop_map(|(p, a)| Action::Propose { proposer: p, amount: a }),
        2 => prop_oneof![Just(ProposerIdx::A), Just(ProposerIdx::B), Just(ProposerIdx::C)]
            .prop_map(Action::CancelOldest),
        1 => Just(Action::ExecuteOldestA),
        1 => (0u64..=300_000u64).prop_map(Action::AdvanceTime),
    ]
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// All six reservation-accounting invariants hold over random sequences of
    /// multi-proposer propose/cancel/execute/advance-time operations.
    #[test]
    fn reservation_accounting_invariants(actions in prop_vec(action_strategy(), 1..50)) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        let proposer_b = Address::generate(&env);
        let proposer_c = Address::generate(&env);
        client.set_role(&admin, &proposer_b, &crate::types::Role::Treasurer);
        client.set_role(&admin, &proposer_c, &crate::types::Role::Treasurer);

        let proposers = [admin.clone(), proposer_b.clone(), proposer_c.clone()];
        let recipient = Address::generate(&env);

        let mut pending_a: VecDeque<u64> = VecDeque::new();
        let mut pending_b: VecDeque<u64> = VecDeque::new();
        let mut pending_c: VecDeque<u64> = VecDeque::new();

        for action in &actions {
            match action {
                Action::Propose { proposer: idx, amount } => {
                    let (proposer, queue) = match idx {
                        ProposerIdx::A => (&proposers[0], &mut pending_a),
                        ProposerIdx::B => (&proposers[1], &mut pending_b),
                        ProposerIdx::C => (&proposers[2], &mut pending_c),
                    };
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        proposer,
                        &recipient,
                        &token,
                        amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        queue.push_back(id);
                    }
                }
                Action::CancelOldest(idx) => {
                    let (proposer, queue) = match idx {
                        ProposerIdx::A => (&proposers[0], &mut pending_a),
                        ProposerIdx::B => (&proposers[1], &mut pending_b),
                        ProposerIdx::C => (&proposers[2], &mut pending_c),
                    };
                    if let Some(id) = queue.pop_front() {
                        let _ = client.try_cancel_proposal(proposer, &id, &Symbol::new(&env, "c"));
                    }
                }
                Action::ExecuteOldestA => {
                    // Approve with both required signers then execute.
                    if let Some(&id) = pending_a.front() {
                        let _ = client.try_approve_proposal(&admin, &id);
                        let _ = client.try_approve_proposal(&proposer_b, &id);
                        if client.try_execute_proposal(&admin, &id).is_ok() {
                            pending_a.pop_front();
                        }
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
            }

            let today = env.ledger().timestamp() / DAY_SECS;
            let week  = env.ledger().timestamp() / WEEK_SECS;

            let spent_today = client.get_daily_spent(&today);
            let spent_week  = client.get_weekly_spent(&week);

            // Reputation-adjusted limits (mirrors contract logic).
            let rep = env.as_contract(&client.address, || {
                storage::get_reputation(&env, &admin)
            });
            let adj_daily  = if rep.score >= 750 { (DAILY_LIMIT * 3) / 2 }  else { DAILY_LIMIT };
            let adj_weekly = if rep.score >= 750 { (WEEKLY_LIMIT * 3) / 2 } else { WEEKLY_LIMIT };

            // Invariants 1–4: counters are non-negative and within limits.
            prop_assert!(spent_today >= 0, "daily counter went negative");
            prop_assert!(spent_week  >= 0, "weekly counter went negative");
            prop_assert!(
                spent_today <= adj_daily,
                "daily spent {} exceeded limit {} (3-proposer)",
                spent_today, adj_daily
            );
            prop_assert!(
                spent_week <= adj_weekly,
                "weekly spent {} exceeded limit {} (3-proposer)",
                spent_week, adj_weekly
            );

            // Invariant 5: total_reserved ≤ vault balance.
            let (reserved, vault_balance) = env.as_contract(&client.address, || {
                let r = storage::get_total_reserved(&env, &token);
                (r, 0i128)
            });
            let vault_balance = vault_balance
                + TokenClient::new(&env, &token).balance(&client.address);
            prop_assert!(
                reserved >= 0 && reserved <= vault_balance,
                "total_reserved {} exceeds vault balance {} — vault is over-promised",
                reserved, vault_balance
            );
        }

        // --- Invariant 6: cancelling everything drives counters to zero ---
        while let Some(id) = pending_a.pop_front() {
            let _ = client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c"));
        }
        while let Some(id) = pending_b.pop_front() {
            let _ = client.try_cancel_proposal(&proposer_b, &id, &Symbol::new(&env, "c"));
        }
        while let Some(id) = pending_c.pop_front() {
            let _ = client.try_cancel_proposal(&proposer_c, &id, &Symbol::new(&env, "c"));
        }

        let today = env.ledger().timestamp() / DAY_SECS;
        let week  = env.ledger().timestamp() / WEEK_SECS;

        prop_assert_eq!(
            client.get_daily_spent(&today), 0,
            "daily counter must be zero after cancelling all pending proposals"
        );
        prop_assert_eq!(
            client.get_weekly_spent(&week), 0,
            "weekly counter must be zero after cancelling all pending proposals"
        );
    }

    /// Property: `get_total_reserved` is always non-negative and never exceeds
    /// the vault's token balance, even across aggressive interleaving of
    /// creates, claims, and cancels.
    #[test]
    fn total_reserved_never_exceeds_balance(
        actions in prop_vec(action_strategy(), 1..40),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let proposer_b = Address::generate(&env);
        client.set_role(&admin, &proposer_b, &crate::types::Role::Treasurer);
        let proposers = [admin.clone(), proposer_b.clone(), admin.clone()];
        let recipient = Address::generate(&env);
        let mut queues: [VecDeque<u64>; 3] = Default::default();

        for action in &actions {
            match action {
                Action::Propose { proposer: idx, amount } => {
                    let i = match idx { ProposerIdx::A => 0, ProposerIdx::B => 1, ProposerIdx::C => 0 };
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        &proposers[i],
                        &recipient,
                        &token,
                        amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        queues[i].push_back(id);
                    }
                }
                Action::CancelOldest(idx) => {
                    let i = match idx { ProposerIdx::A => 0, ProposerIdx::B => 1, ProposerIdx::C => 0 };
                    if let Some(id) = queues[i].pop_front() {
                        let _ = client.try_cancel_proposal(&proposers[i], &id, &Symbol::new(&env, "c"));
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
                _ => {}
            }

            let (reserved, _) = env.as_contract(&client.address, || {
                (storage::get_total_reserved(&env, &token), ())
            });
            let vault_balance = TokenClient::new(&env, &token).balance(&client.address);

            prop_assert!(reserved >= 0, "total_reserved went negative: {}", reserved);
            prop_assert!(
                reserved <= vault_balance,
                "total_reserved {} exceeds vault balance {}",
                reserved, vault_balance
            );
        }
    }
}
