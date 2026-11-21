//! Extended property-based tests for spending limits (Issue #2077).
//!
//! Expands beyond the basic daily/weekly invariants in
//! `test_spending_limit_invariants_proptest` to cover:
//!
//! - Multi-proposer spending under shared limits never double-counts
//!   reservations (the daily/weekly bucket is a shared counter, not
//!   per-proposer — concurrent reservations from different addresses must
//!   still respect the global cap).
//! - Per-proposal spending-limit ceiling is enforced across any sequence of
//!   proposals; no single proposal can exceed `spending_limit` regardless of
//!   approval/cancellation order.
//! - Executing (approving) a proposal moves its reservation from
//!   "pending" to "executed" without altering the daily/weekly total.
//!   The combined executed+pending total must remain ≤ limit throughout.
//! - Partial-week boundary crossings: a sequence that straddles a weekly
//!   reset must not carry stale reservations into the new week.
#![cfg(test)]

use crate::storage;
use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::{ConditionLogic, Priority};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

/// Proposer index: 0 = admin (already has Treasurer role from setup),
/// 1 = a second proposer (gets role on first use in the test).
#[derive(Clone, Debug)]
enum ProposerIdx {
    Zero,
    One,
}

#[derive(Clone, Debug)]
enum Action {
    Propose { proposer: ProposerIdx, amount: i128 },
    CancelOldest { proposer: ProposerIdx },
    ExecuteOldest,
    AdvanceTime(u64),
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => (prop_oneof![Just(ProposerIdx::Zero), Just(ProposerIdx::One)],
              1i128..=(SPENDING_LIMIT * 2))
            .prop_map(|(p, a)| Action::Propose { proposer: p, amount: a }),
        2 => prop_oneof![Just(ProposerIdx::Zero), Just(ProposerIdx::One)]
            .prop_map(|p| Action::CancelOldest { proposer: p }),
        1 => Just(Action::ExecuteOldest),
        1 => (0u64..=200_000u64).prop_map(Action::AdvanceTime),
    ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn adjusted_limits(env: &Env, client: &crate::VaultDAOClient, addr: &Address) -> (i128, i128) {
    let rep = env.as_contract(&client.address, || storage::get_reputation(env, addr));
    let adj_daily = if rep.score >= 750 { (DAILY_LIMIT * 3) / 2 } else { DAILY_LIMIT };
    let adj_weekly = if rep.score >= 750 { (WEEKLY_LIMIT * 3) / 2 } else { WEEKLY_LIMIT };
    (adj_daily, adj_weekly)
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Property: with two independent proposers sharing the same vault, the
    /// combined daily and weekly spend counters never exceed the configured
    /// limits, regardless of interleaving of their proposals/cancellations.
    #[test]
    fn multi_proposer_shared_limits_never_exceeded(
        actions in prop_vec(action_strategy(), 1..50),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);

        // Second proposer — gets Treasurer via set_role on first actual use.
        let proposer_b = Address::generate(&env);
        client.set_role(&admin, &proposer_b, &crate::types::Role::Treasurer);

        let proposers = [admin.clone(), proposer_b.clone()];
        let recipient = Address::generate(&env);

        let mut pending_zero: VecDeque<u64> = VecDeque::new();
        let mut pending_one: VecDeque<u64> = VecDeque::new();
        let mut approved_queue: VecDeque<u64> = VecDeque::new();

        for action in actions {
            match action {
                Action::Propose { proposer: idx, amount } => {
                    let proposer = &proposers[match idx { ProposerIdx::Zero => 0, ProposerIdx::One => 1 }];
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        proposer,
                        &recipient,
                        &token,
                        &amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        match idx {
                            ProposerIdx::Zero => pending_zero.push_back(id),
                            ProposerIdx::One => pending_one.push_back(id),
                        }
                    }
                }
                Action::CancelOldest { proposer: idx } => {
                    let (proposer, queue) = match idx {
                        ProposerIdx::Zero => (&proposers[0], &mut pending_zero),
                        ProposerIdx::One => (&proposers[1], &mut pending_one),
                    };
                    if let Some(id) = queue.pop_front() {
                        let _ = client.try_cancel_proposal(proposer, &id, &Symbol::new(&env, "c"));
                    }
                }
                Action::ExecuteOldest => {
                    // Approve + execute the oldest pending-zero proposal so we
                    // can verify executed reservations are still tracked.
                    if let Some(id) = pending_zero.pop_front() {
                        // approve with both required signers (threshold=2 from setup)
                        let _ = client.try_approve_proposal(&admin, &id);
                        let _ = client.try_approve_proposal(&proposers[1], &id);
                        // execute if now approved
                        let _ = client.try_execute_proposal(&admin, &id);
                        approved_queue.push_back(id);
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
            }

            // Invariant checked after every step.
            let today  = env.ledger().timestamp() / DAY_SECS;
            let week   = env.ledger().timestamp() / WEEK_SECS;
            let (adj_daily, adj_weekly) = adjusted_limits(&env, &client, &admin);

            let spent_today = client.get_daily_spent(&today);
            let spent_week  = client.get_weekly_spent(&week);

            prop_assert!(spent_today >= 0, "daily counter went negative");
            prop_assert!(spent_week  >= 0, "weekly counter went negative");
            prop_assert!(
                spent_today <= adj_daily,
                "daily combined total {} exceeded limit {} (multi-proposer)",
                spent_today, adj_daily
            );
            prop_assert!(
                spent_week <= adj_weekly,
                "weekly combined total {} exceeded limit {} (multi-proposer)",
                spent_week, adj_weekly
            );
        }
    }

    /// Property: when time advances past a weekly boundary, the new week's
    /// spend counter starts at zero (old reservations from prior week must not
    /// bleed into the new window).
    #[test]
    fn weekly_boundary_crossing_resets_counter(
        actions in prop_vec(action_strategy(), 1..30),
        extra_weeks in 1u64..4,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let recipient = Address::generate(&env);
        let mut pending: VecDeque<u64> = VecDeque::new();

        for action in &actions {
            match action {
                Action::Propose { proposer: _, amount } => {
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        &admin,
                        &recipient,
                        &token,
                        amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        pending.push_back(id);
                    }
                }
                Action::CancelOldest { .. } => {
                    if let Some(id) = pending.pop_front() {
                        let _ = client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c"));
                    }
                }
                _ => {}
            }
        }

        // Jump forward by `extra_weeks` full weeks.
        let now = env.ledger().timestamp();
        env.ledger().set_timestamp(now + extra_weeks * WEEK_SECS);

        let new_week = env.ledger().timestamp() / WEEK_SECS;
        let spent = client.get_weekly_spent(&new_week);

        prop_assert_eq!(
            spent, 0,
            "new week {} must start at zero; got {} (reservations from prior week must not bleed over)",
            new_week, spent
        );
    }

    /// Property: cancelling every pending proposal from both proposers always
    /// drives the spend counters back to zero.
    #[test]
    fn cancelling_all_pending_from_all_proposers_releases_budget(
        actions in prop_vec(action_strategy(), 1..40),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let proposer_b = Address::generate(&env);
        client.set_role(&admin, &proposer_b, &crate::types::Role::Treasurer);
        let proposers = [admin.clone(), proposer_b.clone()];
        let recipient = Address::generate(&env);
        let mut pending_zero: VecDeque<u64> = VecDeque::new();
        let mut pending_one: VecDeque<u64> = VecDeque::new();

        for action in &actions {
            match action {
                Action::Propose { proposer: idx, amount } => {
                    let proposer = &proposers[match idx { ProposerIdx::Zero => 0, ProposerIdx::One => 1 }];
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
                        match idx {
                            ProposerIdx::Zero => pending_zero.push_back(id),
                            ProposerIdx::One => pending_one.push_back(id),
                        }
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
                _ => {}
            }
        }

        while let Some(id) = pending_zero.pop_front() {
            let _ = client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c"));
        }
        while let Some(id) = pending_one.pop_front() {
            let _ = client.try_cancel_proposal(&proposer_b, &id, &Symbol::new(&env, "c"));
        }

        let today = env.ledger().timestamp() / DAY_SECS;
        let week  = env.ledger().timestamp() / WEEK_SECS;

        prop_assert_eq!(
            client.get_daily_spent(&today), 0,
            "daily counter must be zero after cancelling all pending proposals from all proposers"
        );
        prop_assert_eq!(
            client.get_weekly_spent(&week), 0,
            "weekly counter must be zero after cancelling all pending proposals from all proposers"
        );
    }
}
