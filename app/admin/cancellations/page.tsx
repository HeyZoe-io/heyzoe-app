import { redirect } from "next/navigation";

export default function AdminCancellationsRedirect() {
  redirect("/admin/businesses?tab=cancellations");
}
