import { redirect } from "next/navigation";

// /cet4 → 首页带四级 Tab
export default function Cet4Page() {
  redirect("/?level=CET4");
}
