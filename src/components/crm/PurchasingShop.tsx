"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, ShoppingCart, Trash2 } from "lucide-react";
import { formatEuro } from "@/lib/format";
import { inkoopProductImageFor } from "@/lib/inkoop-product-images";
import { apexProductUrl } from "@/lib/apex-product-url";
import {
  INKOOP_BESTEL_BEVESTIGING_TEKST,
  type InkoopLeverancierStatus,
} from "@/lib/project-inkoop-checklist";
import { SignaturePadField } from "@/components/offerte/SignaturePadField";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PurchasingOrder, PurchasingOrderLine } from "./purchasing-types";

function defaultLeverdatumYmd(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ProductThumb({
  sku,
  label,
}: {
  sku: string | null;
  label: string;
}) {
  const foto = inkoopProductImageFor(sku, label);
  if (foto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={foto.imageSrc}
        alt=""
        className="h-full w-full object-contain"
      />
    );
  }
  const letter = (label || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="flex h-full w-full items-center justify-center bg-wash text-lg font-semibold text-muted-foreground">
      {letter}
    </span>
  );
}

export function PurchasingShop({
  orders,
  selectedId,
  onSelectId,
  leverancier,
  busy,
  onCheckout,
}: {
  orders: PurchasingOrder[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  leverancier: string;
  busy: boolean;
  onCheckout: (input: {
    order: PurchasingOrder;
    itemKeys: string[];
    klantNaam: string;
    leveradres: string;
    leverdatumYmd: string;
    leverancierStatus: InkoopLeverancierStatus;
    handtekening: string;
    bevestigd: boolean;
  }) => Promise<void>;
}) {
  const shoppable = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.summary.te_kopen > 0 &&
          o.items.some((i) => i.status === "te_kopen")
      ),
    [orders]
  );
  const order =
    shoppable.find((o) => o.id === selectedId) || shoppable[0] || null;

  const teKopen = useMemo(
    () => (order ? order.items.filter((i) => i.status === "te_kopen") : []),
    [order]
  );

  const [cartKeys, setCartKeys] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<"mandje" | "afrekenen">("mandje");
  const [klantNaam, setKlantNaam] = useState("");
  const [leveradres, setLeveradres] = useState("");
  const [leverdatum, setLeverdatum] = useState(defaultLeverdatumYmd(7));
  const [levStatus, setLevStatus] =
    useState<InkoopLeverancierStatus>("op_krediet");
  const [handtekening, setHandtekening] = useState<string | null>(null);
  const [akkoord, setAkkoord] = useState(false);
  const onSig = useCallback((url: string | null) => {
    setHandtekening(url);
  }, []);

  useEffect(() => {
    if (!order) {
      setCartKeys([]);
      return;
    }
    setKlantNaam(order.klant || "");
    setLeveradres(order.leveradres || "");
    setLeverdatum(
      order.materiaal_leverdatum?.slice(0, 10) || defaultLeverdatumYmd(7)
    );
    setCartKeys([]);
    setStep("mandje");
    setAkkoord(false);
    setHandtekening(null);
  }, [order?.id]);

  const cartItems = useMemo(() => {
    if (!order) return [] as PurchasingOrderLine[];
    return teKopen.filter((i) => cartKeys.includes(i.key));
  }, [order, teKopen, cartKeys]);

  const cartTotal = cartItems.reduce(
    (s, i) => s + i.inkoop_ex_btw * (i.aantal || 1),
    0
  );

  function addToCart(key: string) {
    setCartKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCartOpen(true);
    setStep("mandje");
  }

  function removeFromCart(key: string) {
    setCartKeys((prev) => prev.filter((k) => k !== key));
  }

  async function submit() {
    if (!order) return;
    await onCheckout({
      order,
      itemKeys: cartKeys,
      klantNaam,
      leveradres,
      leverdatumYmd: leverdatum,
      leverancierStatus: levStatus,
      handtekening: handtekening || "",
      bevestigd: akkoord,
    });
    setCartKeys([]);
    setCartOpen(false);
    setStep("mandje");
    setAkkoord(false);
    setHandtekening(null);
  }

  if (shoppable.length === 0) {
    return (
      <Card className="bg-white shadow-none">
        <CardHeader>
          <CardTitle>Winkel</CardTitle>
          <CardDescription>
            Geen open inkoop. Orders komen hier als er nog te bestellen
            producten op een project staan.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-white shadow-none">
        <CardHeader className="border-b">
          <CardTitle>Winkel · {leverancier}</CardTitle>
          <CardDescription>
            Kies het project, zet producten in het mandje en rond af met
            klantgegevens en een krabbel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="grid min-w-[220px] flex-1 gap-1.5">
            <Label htmlFor="shop-project">Project</Label>
            <NativeSelect
              id="shop-project"
              className="w-full max-w-md"
              value={order?.id || ""}
              onChange={(e) => onSelectId(e.target.value)}
            >
              {shoppable.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {o.project_nummer || "Project"} · {o.klant} ·{" "}
                  {o.summary.te_kopen} open
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCartOpen(true);
              setStep("mandje");
            }}
          >
            <ShoppingCart />
            Mandje
            {cartItems.length > 0 ? (
              <Badge variant="secondary">{cartItems.length}</Badge>
            ) : null}
          </Button>
        </CardContent>
      </Card>

      {order ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teKopen.map((item) => {
              const inCart = cartKeys.includes(item.key);
              const foto = inkoopProductImageFor(item.sku, item.label);
              return (
                <Card key={item.key} className="bg-white shadow-none" size="sm">
                  <div className="flex h-36 items-center justify-center border-b bg-[#0a0a0a]">
                    <div className="h-32 w-32">
                      <ProductThumb sku={item.sku} label={item.label} />
                    </div>
                  </div>
                  <CardHeader>
                    <CardTitle className="line-clamp-2 text-sm">
                      {foto?.naam || item.label}
                    </CardTitle>
                    <CardDescription>
                      {item.sku || "Geen SKU"} · {item.aantal}× ·{" "}
                      {formatEuro(item.inkoop_ex_btw)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={inCart}
                      onClick={() => addToCart(item.key)}
                    >
                      {inCart ? "In mandje" : "Toevoegen"}
                    </Button>
                    <a
                      href={apexProductUrl(item.sku, item.label)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      Apex
                    </a>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="h-fit bg-white shadow-none" size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{order.klant}</CardTitle>
              <CardDescription>
                {order.project_nummer}
                {order.offerte_nummer ? ` · ${order.offerte_nummer}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {order.leveradres || "Geen leveradres"}
              </p>
              <Link
                href={`/projecten/${order.id}?from=purchasing`}
                prefetch={false}
                className="font-medium text-green-dark underline-offset-2 hover:underline"
              >
                Open project
              </Link>
              {order.schouw.formulier_url ? (
                <a
                  href={order.schouw.formulier_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 font-medium text-green-dark underline-offset-2 hover:underline"
                >
                  <FileText className="size-3.5" />
                  Schouwrapport
                </a>
              ) : (
                <p className="text-muted-foreground">Geen schouwrapport</p>
              )}
              {order.inkoop_extra_notities ? (
                <p className="rounded-md bg-[#FFF8D6] px-2 py-1.5 text-xs">
                  {order.inkoop_extra_notities}
                </p>
              ) : null}
              <Separator />
              <Button
                type="button"
                className="w-full"
                variant="outline"
                onClick={() => {
                  setCartKeys(teKopen.map((i) => i.key));
                  setCartOpen(true);
                  setStep("mandje");
                }}
              >
                Alles in mandje
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Sheet
        open={cartOpen}
        onOpenChange={(open) => {
          setCartOpen(open);
          if (!open) setStep("mandje");
        }}
      >
        <SheetContent
          side="right"
          className="sm:max-w-md"
          showCloseButton
        >
          <SheetHeader>
            <SheetTitle>
              {step === "mandje" ? "Winkelmandje" : "Afrekenen"}
            </SheetTitle>
            <SheetDescription>
              {order
                ? `${order.project_nummer || "Project"} · ${order.klant}`
                : "Kies eerst een project"}
            </SheetDescription>
          </SheetHeader>

          {step === "mandje" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
              {cartItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Mandje is leeg. Voeg producten toe vanuit de winkel.
                </p>
              ) : (
                cartItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 border-b pb-3"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-[#0a0a0a]">
                      <ProductThumb sku={item.sku} label={item.label} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.aantal}× · {formatEuro(item.inkoop_ex_btw)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => removeFromCart(item.key)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor="chk-klant">Klant</Label>
                <Input
                  id="chk-klant"
                  value={klantNaam}
                  onChange={(e) => setKlantNaam(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="chk-adres">Leveradres / klantgegevens</Label>
                <Input
                  id="chk-adres"
                  value={leveradres}
                  onChange={(e) => setLeveradres(e.target.value)}
                />
              </div>
              {order?.schouw.formulier_url ? (
                <a
                  href={order.schouw.formulier_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium text-green-dark underline-offset-2 hover:underline"
                >
                  <FileText className="size-3.5" />
                  Open schouwrapport
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Geen schouwrapport op dit project.
                </p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="chk-lev">Verwachte leverdatum</Label>
                <Input
                  id="chk-lev"
                  type="date"
                  value={leverdatum}
                  onChange={(e) => setLeverdatum(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="chk-pay">Leverancier</Label>
                <NativeSelect
                  id="chk-pay"
                  value={levStatus}
                  onChange={(e) =>
                    setLevStatus(e.target.value as InkoopLeverancierStatus)
                  }
                >
                  <NativeSelectOption value="op_krediet">
                    Op krediet
                  </NativeSelectOption>
                  <NativeSelectOption value="betaald">
                    Direct betaald
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="chk-akkoord"
                  checked={akkoord}
                  onCheckedChange={(v) => setAkkoord(v === true)}
                />
                <Label htmlFor="chk-akkoord" className="text-sm leading-snug">
                  {INKOOP_BESTEL_BEVESTIGING_TEKST}
                </Label>
              </div>
              <div>
                <Label>Krabbel</Label>
                <div className="mt-1 overflow-hidden rounded-lg border bg-white">
                  <SignaturePadField onChange={onSig} />
                </div>
              </div>
            </div>
          )}

          <SheetFooter>
            <p className="text-sm font-medium tabular-nums">
              Totaal excl. {formatEuro(cartTotal)}
            </p>
            {step === "mandje" ? (
              <Button
                type="button"
                disabled={cartItems.length === 0}
                onClick={() => setStep("afrekenen")}
              >
                Naar afrekenen
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("mandje")}
                >
                  Terug
                </Button>
                <Button
                  type="button"
                  disabled={
                    busy ||
                    !akkoord ||
                    !handtekening ||
                    !klantNaam.trim() ||
                    !leverdatum ||
                    cartItems.length === 0
                  }
                  onClick={() => void submit()}
                >
                  {busy ? "Bezig…" : "Bestelling plaatsen"}
                </Button>
              </div>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
