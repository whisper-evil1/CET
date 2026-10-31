import { redirect } from "next/navigation";

/** /cet4 重定向到首页四级 Tab，保持单一数据源 */
export default function Cet4Page() {
  redirect("/?level=CET4");
}
