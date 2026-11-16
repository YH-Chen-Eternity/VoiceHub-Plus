import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  findSuperAdminOnlySettingFields,
  stripSuperAdminOnlySettingFields
} from '../../app/utils/settingsPermissions.ts'

// 系统设置里的凭据、隐私与账号安全策略字段只归超级管理员，普通管理员读写都要受控
const read = (relative: string) => readFileSync(join(import.meta.dirname, relative), 'utf8')

test('识别并剔除超管专属字段，普通配置原样保留', () => {
  const payload = { siteTitle: '校园广播', smtpPassword: 'secret', allowRegister: false }
  assert.deepEqual(findSuperAdminOnlySettingFields(payload), ['smtpPassword', 'allowRegister'])
  assert.deepEqual(stripSuperAdminOnlySettingFields(payload), { siteTitle: '校园广播' })
  assert.deepEqual(findSuperAdminOnlySettingFields(null), [])
})

test('写入接口拒绝普通管理员提交超管字段，读取接口对普通管理员裁剪', () => {
  const post = read('../../server/api/admin/system-settings/index.post.ts')
  assert.match(post, /findSuperAdminOnlySettingFields\(body\)/, '写入前应检查超管专属字段')
  assert.match(post, /statusCode: 403/, '命中超管字段应返回 403')

  const get = read('../../server/api/admin/system-settings/index.ts')
  assert.match(get, /stripSuperAdminOnlySettingFields\(masked\)/, '普通管理员响应应裁剪超管字段')

  const form = read('../../app/components/Admin/SiteConfigManager.vue')
  assert.match(form, /stripSuperAdminOnlySettingFields\(configToSave\)/, '表单提交前应剔除超管字段，避免整表单被拒')
})
