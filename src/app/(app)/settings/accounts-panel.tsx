"use client";

import { useState } from "react";
import { KeyRoundIcon, LockOpenIcon, PencilIcon, PlusIcon, UserRoundCogIcon } from "lucide-react";

import { useAction } from "@/components/use-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatTimestamp } from "@/lib/dates";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  createAccount,
  resetAccountPassword,
  unlockAccount,
  updateAccount,
} from "@/server/actions/accounts";

export interface AccountRecord {
  id: string;
  username: string;
  displayName: string;
  role: "OWNER" | "MANAGER";
  active: boolean;
  /** Resolved on the server so the component stays pure. */
  locked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
  lastLoginAt: string | null;
}

type DialogKind = "create" | "edit" | "password";

export function AccountsPanel({
  accounts,
  canManage,
  currentAccountId,
}: {
  accounts: AccountRecord[];
  canManage: boolean;
  currentAccountId: string;
}) {
  const [dialog, setDialog] = useState<{
    kind: DialogKind;
    account: AccountRecord | null;
  } | null>(null);

  const activeOwners = accounts.filter(
    (account) => account.role === "OWNER" && account.active,
  ).length;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <UserRoundCogIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <h2 className="font-heading text-sm font-semibold">Sign-ins</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Everyone who can change the register has their own account, so each
              change is recorded against a person. Five failed attempts lock an
              account for 15 minutes.
            </p>
          </div>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setDialog({ kind: "create", account: null })}>
            <PlusIcon />
            Add sign-in
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <Alert className="mt-4">
          <KeyRoundIcon />
          <AlertTitle>Owner only</AlertTitle>
          <AlertDescription className="text-xs">
            Only an owner account can add sign-ins or reset passwords. Ask the
            owner if you need a change here.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Username</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Last signed in</th>
              {canManage ? (
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const locked = account.active && account.locked;
              return (
                <tr key={account.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{account.username}</td>
                  <td className="px-3 py-2 font-medium">
                    {account.displayName}
                    {account.id === currentAccountId ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">(you)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={account.role === "OWNER" ? "default" : "secondary"}>
                      {account.role.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {!account.active ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        deactivated
                      </Badge>
                    ) : locked ? (
                      <Badge variant="destructive">
                        locked until {formatTimestamp(new Date(account.lockedUntil!))}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                        active
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {account.lastLoginAt
                      ? formatTimestamp(new Date(account.lastLoginAt))
                      : "never"}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {locked ? (
                          <UnlockButton account={account} />
                        ) : null}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Reset password for ${account.username}`}
                          onClick={() => setDialog({ kind: "password", account })}
                        >
                          <KeyRoundIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Edit ${account.username}`}
                          onClick={() => setDialog({ kind: "edit", account })}
                        >
                          <PencilIcon />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage && activeOwners <= 1 ? (
        <Alert className="mt-3">
          <AlertDescription className="text-xs">
            There is only one active owner. Add a second owner before changing
            this one, so you cannot lock everybody out.
          </AlertDescription>
        </Alert>
      ) : null}

      <AccountDialog
        key={
          dialog
            ? `${dialog.kind}-${dialog.account?.id ?? "new"}`
            : "closed"
        }
        kind={dialog?.kind ?? null}
        account={dialog?.account ?? null}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

function UnlockButton({ account }: { account: AccountRecord }) {
  const { run, pending } = useAction();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={`Unlock ${account.username}`}
      disabled={pending}
      onClick={() => run(() => unlockAccount({ id: account.id }))}
    >
      <LockOpenIcon />
    </Button>
  );
}

function AccountDialog({
  kind,
  account,
  onClose,
}: {
  kind: DialogKind | null;
  account: AccountRecord | null;
  onClose: () => void;
}) {
  const { run, pending, error } = useAction();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [role, setRole] = useState<"OWNER" | "MANAGER">(account?.role ?? "MANAGER");
  const [active, setActive] = useState(account?.active ?? true);
  const [password, setPassword] = useState("");

  if (!kind) return null;

  const titles: Record<DialogKind, string> = {
    create: "Add a sign-in",
    edit: `Edit ${account?.username ?? ""}`,
    password: `Reset password for ${account?.username ?? ""}`,
  };

  function submit() {
    if (kind === "create") {
      run(
        () => createAccount({ username, displayName, role, password }),
        { onSuccess: onClose },
      );
      return;
    }
    if (kind === "edit" && account) {
      run(
        () => updateAccount({ id: account.id, displayName, role, active }),
        { onSuccess: onClose },
      );
      return;
    }
    if (kind === "password" && account) {
      run(() => resetAccountPassword({ id: account.id, password }), {
        onSuccess: onClose,
      });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
          <DialogDescription>
            {kind === "create"
              ? "The password must be at least 8 characters and not a known default."
              : kind === "password"
                ? "Setting a new password also clears any lockout."
                : "Changing a role or deactivating an account takes effect immediately."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {kind === "create" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="account-username">Username</Label>
              <Input
                id="account-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="e.g. rakib"
              />
            </div>
          ) : null}

          {kind !== "password" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="account-name">Display name</Label>
                <Input
                  id="account-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="e.g. Rakib Hasan"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="account-role">Role</Label>
                <Select value={role} onValueChange={(value) => setRole(value as "OWNER" | "MANAGER")}>
                  <SelectTrigger id="account-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">
                      Manager — can run the register
                    </SelectItem>
                    <SelectItem value="OWNER">
                      Owner — can also manage sign-ins
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {kind === "edit" ? (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor="account-active" className="text-sm">
                Account active
              </Label>
              <Switch id="account-active" checked={active} onCheckedChange={setActive} />
            </div>
          ) : null}

          {kind !== "edit" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="account-password">Password</Label>
              <Input
                id="account-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {kind === "create" ? "Create sign-in" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
