/**
 * V-01：JWT 密钥强度在进程启动期校验一次。
 *
 * 路由 chunk 是懒加载的，JWTEnhanced 的静态校验只在「首个认证请求」时触发，
 * 那时服务已经对外监听，弱密钥会被静默带进运行态。这里把校验提前到启动阶段：
 * 漏配、过短、示例值或低熵密钥一律让进程直接退出，不带着可伪造的认证根对外服务。
 */
import { loadJwtSecretOrFail } from '~~/server/utils/jwt-enhanced'

export default defineNitroPlugin(() => {
  loadJwtSecretOrFail()
})
