-- 0047: 清掉「已經有收款分配、卻還留著待連結旗標」的交易。
--
-- #126 之後，有 payment_allocations 的交易不再被連結層比對、也不會出現在待連結頁；但在那之前就留下的
-- review_reason（link_suggested / link_ambiguous / link_amount_mismatch）與 link_candidates 還在，
-- update_transaction 會把這些過期的候選回傳出去，跟分配互相矛盾（例：#1505 被建議整筆綁到請款項目 #32，
-- 實際上已經拆成訂閱期別＋請款項目）。程式端同時改成：更新有分配的交易時一併清掉（src/lib/linking/write.ts）。
--
-- party_similar（對象的事）與 link_skipped（人的決定）不動。冪等，可重跑。Run AFTER 0046_current_org.sql。

UPDATE transactions t
SET review_reason = NULL, link_candidates = NULL
WHERE t.review_reason IN ('link_suggested', 'link_ambiguous', 'link_amount_mismatch')
  AND EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.transaction_id = t.id);
