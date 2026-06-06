import { redirect } from "next/navigation";

// Google OAuth auto-creates the user on first sign-in, so there is no
// separate sign-up flow. Send everyone to the single login entry point.
export default function SignupPage() {
  redirect("/login");
}
