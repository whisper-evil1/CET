import { redirect } from "next/navigation";

/** /cet6 重定向到首页六级 Tab，保持单一数据源 */
export default function Cet6Page() {
  redirect("/?level=CET6");
}
