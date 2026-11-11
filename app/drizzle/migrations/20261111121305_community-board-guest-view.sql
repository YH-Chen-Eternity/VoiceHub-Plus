-- 游客板块可见性开关（2026-11-11）：默认关闭，存量板块行为不变（对游客不可见）。
-- 单列 ADD COLUMN，PostgreSQL 事务安全；如需回滚：ALTER TABLE "CommunityBoard" DROP COLUMN "allowGuestView";
ALTER TABLE "CommunityBoard" ADD COLUMN "allowGuestView" boolean DEFAULT false NOT NULL;
