import { createFileRoute, redirect } from "@tanstack/react-router";

// VibeBoss: rules now sit below the roles on one page.
export const Route = createFileRoute("/_chat/rules")({
  beforeLoad: () => {
    throw redirect({ to: "/agents", replace: true });
  },
});
