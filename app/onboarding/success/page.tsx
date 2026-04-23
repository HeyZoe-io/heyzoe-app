import { Suspense } from "react";
import OnboardingSuccessClient from "./client";

export default function OnboardingSuccessPage() {
  return (
    <Suspense>
      <OnboardingSuccessClient />
    </Suspense>
  );
}

