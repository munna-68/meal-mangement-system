"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MoonStarIcon } from "lucide-react";
import { updateMessSettings } from "@/server/actions/settings";

export function SettingsClient({
  hostelName: initialName,
  address: initialAddress,
  ramadanMode: initialRamadan,
  soloElectricityMultiplier: initialSoloElectricity,
  soloWifiMultiplier: initialSoloWifi,
}: {
  hostelName: string;
  address: string;
  ramadanMode: boolean;
  soloElectricityMultiplier: number;
  soloWifiMultiplier: number;
}) {
  const { run, pending, error } = useAction();
  const [hostelName, setHostelName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [ramadanMode, setRamadanMode] = useState(initialRamadan);
  const [soloElectricity, setSoloElectricity] = useState(
    String(initialSoloElectricity),
  );
  const [soloWifi, setSoloWifi] = useState(String(initialSoloWifi));

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-heading text-sm font-semibold">Identity</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Printed at the top of every bazar slip and settlement ledger.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="hostel-name">Hostel name</Label>
            <Input
              id="hostel-name"
              value={hostelName}
              onChange={(event) => setHostelName(event.target.value)}
              className="font-bengali"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="font-bengali"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <MoonStarIcon className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <h2 className="font-heading text-sm font-semibold">Ramadan mode</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Adds a Sehri column to the daily board and includes Sehri in the
                month&rsquo;s settlement.
              </p>
            </div>
          </div>
          <Switch
            id="ramadan-mode"
            checked={ramadanMode}
            onCheckedChange={setRamadanMode}
          />
        </div>

        {ramadanMode ? (
          <Alert className="mt-3">
            <MoonStarIcon />
            <AlertTitle>Sehri tracking is on</AlertTitle>
            <AlertDescription className="text-xs">
              Sehri is priced at the Sehri rate from the rate card. It is off by
              default and hidden from the daily screens when disabled.
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-heading text-sm font-semibold">
          Solo member utility share
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Electricity and wi-fi are split evenly across every active member. A
          member alone in a multi-bed room can be charged a multiple of that
          share — set the multiple to 1 to charge them the same as everyone
          else.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="solo-electricity">Electricity multiple</Label>
            <Input
              id="solo-electricity"
              type="number"
              min={1}
              max={10}
              step={1}
              value={soloElectricity}
              onChange={(event) => setSoloElectricity(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Default 2 — a solo member pays double the electricity share.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="solo-wifi">Wi-fi multiple</Label>
            <Input
              id="solo-wifi"
              type="number"
              min={1}
              max={10}
              step={1}
              value={soloWifi}
              onChange={(event) => setSoloWifi(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Default 1 — wi-fi is not doubled for a solo member.
            </p>
          </div>
        </div>

        <Alert className="mt-3">
          <AlertDescription className="text-xs">
            The Khala (maid) rate for a solo member is separate — set it as the
            &ldquo;Khala solo rate&rdquo; on the Rate Card.
          </AlertDescription>
        </Alert>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            run(() =>
              updateMessSettings({
                hostelName,
                address,
                ramadanMode,
                soloElectricityMultiplier: Number(soloElectricity) || 1,
                soloWifiMultiplier: Number(soloWifi) || 1,
              }),
            )
          }
        >
          Save settings
        </Button>
        <span className="text-xs text-muted-foreground">
          Changes to Ramadan mode take effect immediately across the app.
        </span>
      </div>
    </div>
  );
}
