-- 快照桥接迁移（no-op）：本迁移对应的真实结构变更（社区点赞相关表/列/索引）
-- 已由先前的手写迁移（20261026235000_open_nesting、20261027085000_comment_like_reveal 等）落地。
-- 本迁移仅用于把 drizzle 快照链（meta/20261108123352_snapshot.json）推进到与 schema.ts 一致，
-- 使全新库可按序完整迁移、且 schema 漂移校验通过。
SELECT 1;
