/**
 * jsonwebtoken 的测试替身：启动期校验只依赖 JWT_SECRET，不需要真实签名实现。
 */
export default {
  sign: () => 'stub-token',
  verify: () => ({})
}
