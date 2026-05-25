import { redirect } from "next/navigation";

export default function AdminRequestsRedirect() {
  redirect("/admin/businesses?tab=requests");
}
