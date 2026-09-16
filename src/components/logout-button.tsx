import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/login/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      {/*
        Hidden on small screens: the mobile bottom bar carries Lock, and the
        header slot next to it is taken by the all-screens menu.
      */}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="hidden lg:inline-flex"
      >
        <LogOutIcon />
        <span className="hidden sm:inline">Lock</span>
      </Button>
    </form>
  );
}
