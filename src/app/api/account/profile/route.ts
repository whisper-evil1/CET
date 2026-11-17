import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { Errors, ok, withApi } from "@/lib/api-helpers";

/**
 * 当前账号的登录方式与安全状态。
 * 「我的」页是服务端渲染直接查库的，这个接口留给验收脚本与将来的客户端设置页。
 */
export const GET = withApi(async () => {
  const uid = await currentUserId();
  if (!uid) return Errors.unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { email: true, phone: true, name: true, passwordSet: true, createdAt: true },
  });
  if (!user) return Errors.unauthorized();

  return ok({
    ...user,
    /** 邮箱是不是「只有手机号时占位用的合成邮箱」 */
    syntheticEmail: user.email.endsWith("@phone.local"),
  });
});
