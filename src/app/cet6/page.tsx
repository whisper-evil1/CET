import { redirect } from "next/navigation";

// /cet6 → 首页带六级 Tab
export default function Cet6Page() {
  redirect("/?level=CET6");
}
