import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { community as zhCommunity } from '../../app/utils/locale/zh-CN.ts'
import { community as enCommunity } from '../../app/utils/locale/en-US.ts'

/**
 * 社区游客板块可见性 & 后台栏目权限策略测试（2026-11-11）。
 *
 * 背景：
 * 1. 板块新增 allowGuestView（默认关）：游客只能浏览开启该开关板块的已通过帖子，
 *    列表 / 详情 / 评论三条读取链路都必须收紧，防直链绕过。
 * 2. 社区归档记录收权：仅 ADMIN / SUPER_ADMIN 可见可用，审帖员不再出现在菜单，
 *    后端 archive 端点同步 requireCommunityAdmin。
 * 3. 举报与申诉保留给审帖员（requireCommunityReviewer 链路不回收）。
 *
 * usePermissions.ts 含 ~~/* 别名导入，无法在 Node 单测内直接加载，
 * 这里按仓库既有 policy 测试惯例对源码做结构断言（正则锚定角色行），
 * 防止后续改动无意间把归档还给审帖员或弄丢举报申诉入口。
 */

const repoRoot = join(process.cwd())
const permissionsSource = readFileSync(join(repoRoot, 'app/composables/usePermissions.ts'), 'utf-8')

function extractRoleList(role: 'REVIEWER' | 'ADMIN' | 'BROADCASTER', occurrence: 1 | 2): string {
  // canAccessPage 用 includes(page) 形式，getUserPages 用 switch 返回数组形式，
  // 两种形态各出现一次，因此每个角色有两处列表需要同时断言。
  const pattern =
    occurrence === 1
      ? new RegExp(`role === '${role}'` + String.raw`[\s\S]{0,80}?return \[([^\]]*)\]\.includes`)
      : new RegExp(String.raw`case '${role}':\s*\n\s*return \[([^\]]*)\]`)
  const match = permissionsSource.match(pattern)
  assert.ok(match, `usePermissions.ts 中应能定位 ${role} 的第 ${occurrence} 处页面列表`)
  return match[1]
}

test('归档收权：审帖员页面列表（canAccessPage + getUserPages）不再包含社区归档记录', () => {
  for (const occurrence of [1, 2] as const) {
    const list = extractRoleList('REVIEWER', occurrence)
    assert.ok(!list.includes('community-archive'), `REVIEWER 第 ${occurrence} 处列表不应包含 community-archive`)
    assert.ok(list.includes('community-review'), `REVIEWER 第 ${occurrence} 处列表应保留 community-review`)
    assert.ok(list.includes('community-comment-review'), `REVIEWER 第 ${occurrence} 处列表应保留 community-comment-review`)
  }
})

test('举报与申诉：审帖员页面列表两处均保留 community-reports', () => {
  for (const occurrence of [1, 2] as const) {
    const list = extractRoleList('REVIEWER', occurrence)
    assert.ok(list.includes('community-reports'), `REVIEWER 第 ${occurrence} 处列表应保留 community-reports`)
  }
})

test('归档收权：管理员与超管仍保留社区归档记录入口', () => {
  for (const occurrence of [1, 2] as const) {
    const adminList = extractRoleList('ADMIN', occurrence)
    assert.ok(adminList.includes('community-archive'), `ADMIN 第 ${occurrence} 处列表应保留 community-archive`)
  }
  // SUPER_ADMIN 在 canAccessPage 直接 return true，getUserPages 全量列表
  assert.match(
    permissionsSource,
    /if \(role === 'SUPER_ADMIN'\) return true/,
    'SUPER_ADMIN 应在 canAccessPage 放行全部页面'
  )
})

test('归档端点收权：archive 列表与恢复接口均已改为 requireCommunityAdmin', () => {
  const listSource = readFileSync(join(repoRoot, 'server/api/admin/community/archive.get.ts'), 'utf-8')
  assert.ok(
    listSource.includes('requireCommunityAdmin'),
    'archive.get.ts 应使用 requireCommunityAdmin'
  )
  assert.ok(
    !listSource.includes('requireCommunityReviewer'),
    'archive.get.ts 不应再允许审帖员访问'
  )

  const restoreSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/archive/[type]/[id]/restore.post.ts'),
    'utf-8'
  )
  assert.ok(
    restoreSource.includes('requireCommunityAdmin'),
    'restore.post.ts 应使用 requireCommunityAdmin'
  )
  assert.ok(
    !restoreSource.includes('requireCommunityReviewer'),
    'restore.post.ts 不应再允许审帖员访问'
  )

  // 举报 / 申诉队列保持审帖员可访问（收权只针对归档，不误伤）
  const reportsSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/reports/index.get.ts'),
    'utf-8'
  )
  const appealsSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/appeals/index.get.ts'),
    'utf-8'
  )
  assert.ok(reportsSource.includes('requireCommunityReviewer'), '举报队列应保留审帖员访问')
  assert.ok(appealsSource.includes('requireCommunityReviewer'), '申诉队列应保留审帖员访问')
})

test('游客板块可见性：schema 含 allowGuestView 且默认关闭，迁移文件存在', () => {
  const schemaSource = readFileSync(join(repoRoot, 'app/drizzle/schema.ts'), 'utf-8')
  assert.match(
    schemaSource,
    /allowGuestView: boolean\('allowGuestView'\)\.default\(false\)\.notNull\(\)/,
    'communityBoards 应有 allowGuestView 布尔列且默认 false'
  )

  const journal = JSON.parse(
    readFileSync(join(repoRoot, 'app/drizzle/migrations/meta/_journal.json'), 'utf-8')
  )
  const entry = (journal.entries || []).find(
    (item: { tag?: string }) => item.tag?.endsWith('community-board-guest-view')
  )
  assert.ok(entry, '迁移 journal 应包含 community-board-guest-view')

  const migrationFile = join(repoRoot, 'app/drizzle/migrations', `${entry!.tag}.sql`)
  const migrationSource = readFileSync(migrationFile, 'utf-8')
  assert.match(
    migrationSource,
    /ADD COLUMN "allowGuestView" boolean DEFAULT false NOT NULL/,
    '迁移 SQL 应为 CommunityBoard 增加 allowGuestView 列'
  )
})

test('游客板块可见性：三条读取链路均接入游客白名单过滤', () => {
  const listSource = readFileSync(
    join(repoRoot, 'server/api/community/posts/index.get.ts'),
    'utf-8'
  )
  assert.ok(
    listSource.includes('getGuestVisibleBoardIds'),
    '帖子列表应按游客可见板块过滤'
  )

  const detailSource = readFileSync(
    join(repoRoot, 'server/api/community/posts/[id].get.ts'),
    'utf-8'
  )
  assert.ok(
    detailSource.includes('isBoardGuestVisible'),
    '帖子详情应拒绝游客访问禁看板块（404 不泄露存在性）'
  )

  const commentsSource = readFileSync(
    join(repoRoot, 'server/api/community/posts/[id]/comments.get.ts'),
    'utf-8'
  )
  assert.ok(
    commentsSource.includes('isBoardGuestVisible'),
    '评论列表应拒绝游客读取禁看板块帖子的评论'
  )

  const boardsSource = readFileSync(
    join(repoRoot, 'server/api/community/boards.get.ts'),
    'utf-8'
  )
  assert.ok(
    boardsSource.includes('allowGuestView') && boardsSource.includes('isCommunityGuest'),
    '板块列表对游客应只返回开启游客可见的板块'
  )
})

test('后台板块管理：allowGuestView 读写链路齐全', () => {
  const listSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/boards/index.get.ts'),
    'utf-8'
  )
  const createSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/boards/index.post.ts'),
    'utf-8'
  )
  const updateSource = readFileSync(
    join(repoRoot, 'server/api/admin/community/boards/[id].put.ts'),
    'utf-8'
  )
  assert.ok(listSource.includes('allowGuestView'), '后台板块列表应返回 allowGuestView')
  assert.match(
    createSource,
    /allowGuestView: body\?\.allowGuestView === true/,
    '后台创建板块应接受 allowGuestView 且仅显式 true 才开启'
  )
  assert.match(
    updateSource,
    /typeof body\?\.allowGuestView === 'boolean'/,
    '后台更新板块应接受 allowGuestView 布尔开关'
  )
})

test('双语词典：游客可见开关文案 zh/en 键一致', () => {
  const zhAdmin = (zhCommunity as Record<string, any>)?.admin || {}
  const enAdmin = (enCommunity as Record<string, any>)?.admin || {}
  const zhKeys = ['guestViewLabel', 'guestViewHint', 'guestViewOn', 'guestViewOff', 'guestViewSaved']
  for (const key of zhKeys) {
    assert.ok(
      typeof zhAdmin[key] === 'string' && zhAdmin[key],
      `zh-CN community.admin 缺少 ${key}`
    )
    assert.ok(
      typeof enAdmin[key] === 'string' && enAdmin[key],
      `en-US community.admin 缺少 ${key}`
    )
  }
})

test('系统状态回归：放歌员/歌曲管理员获得受限载荷，内部细节仅管理员可见', () => {
  const statusSource = readFileSync(join(repoRoot, 'server/api/system/status.get.ts'), 'utf-8')
  assert.match(statusSource, /FULL_ADMIN_ROLES = \['ADMIN', 'SUPER_ADMIN'\]/)
  assert.match(statusSource, /OVERVIEW_ROLES = \['SONG_ADMIN', 'BROADCASTER'\]/)
  // 显式白名单放行，其余角色（含 REVIEWER/普通用户/未登录）403
  assert.match(
    statusSource,
    /\[\.\.\.FULL_ADMIN_ROLES, \.\.\.OVERVIEW_ROLES\]\.includes\(role\)/,
    '入口应为两类角色的显式白名单'
  )
  // 受限分支 = 从受限 return 到管理员分支 try 之间，锚点不依赖缩进格式
  const gateIdx = statusSource.indexOf('if (!FULL_ADMIN_ROLES.includes(role)) {')
  assert.ok(gateIdx > 0, '应能定位受限角色分支入口')
  const tryIdx = statusSource.indexOf('try {', gateIdx)
  assert.ok(tryIdx > gateIdx, '受限分支之后应是管理员完整分支的 try 块')
  const limitedBranch = statusSource.slice(gateIdx, tryIdx)
  assert.match(limitedBranch, /status: 'ok'/, '受限分支应返回 status ok')
  assert.match(limitedBranch, /connected: dbStatus\.connected/, '受限分支应返回数据库连通性')
  assert.ok(!limitedBranch.includes('poolStatus'), '受限分支不应包含 poolStatus')
  assert.ok(!limitedBranch.includes('instanceId'), '受限分支不应包含 instanceId')
  assert.ok(!limitedBranch.includes('heapUsed'), '受限分支不应包含进程内存信息')
  // 完整分支（管理员）仍保留细节字段
  assert.match(statusSource, /instanceId/, '管理员分支应保留实例 ID')
  assert.match(statusSource, /poolStatus/, '管理员分支应保留连接池状态')
})
