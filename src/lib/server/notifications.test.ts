import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "info-mail-"));

vi.mock("$env/dynamic/private", () => ({
  env: { DATA_DIR: TMP, DEMO_DATA: "false", ORIGIN: "https://portal.example" },
}));
vi.mock("$app/environment", () => ({
  dev: true,
  browser: false,
  building: false,
  version: "test",
}));

// Mails nicht verschicken, sondern mitschreiben
const sent = vi.hoisted(
  () => [] as { to: string; subject: string; text: string }[],
);
vi.mock("$lib/server/mail", async (original) => ({
  ...(await original<typeof import("$lib/server/mail")>()),
  isMailConfigured: () => true,
  sendMail: async (m: { to: string; subject: string; text: string }) => (
    sent.push(m),
    true
  ),
}));

const { db, client, ensureDatabase } = await import("$lib/server/db");
const { notifications, users } = await import("$lib/server/db/schema");
const { updateSettings } = await import("$lib/server/settings");
const {
  listNotifications,
  mailRecipientsFor,
  markRead,
  myNotificationEvents,
  notificationSettings,
  notify,
  purgeOldNotifications,
  resetNotificationSettings,
  saveNotificationSettings,
  setMuted,
  unreadSummary,
} = await import("./notifications");

let n = 0;
async function person(
  role:
    | "admin"
    | "geschaeftsfuehrer"
    | "bauleiter"
    | "buchhaltung"
    | "partiefuehrer",
  email: string | null,
) {
  const row = await db
    .insert(users)
    .values({
      username: `mail${++n}`,
      firstName: "Test",
      lastName: String(n),
      passwordHash: "x",
      role,
      email,
    })
    .returning({ id: users.id })
    .get();
  return row.id;
}

beforeAll(async () => {
  await ensureDatabase();
});

afterAll(() => {
  client.close();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* Windows: Datenbank noch gesperrt */
  }
});

describe("Info-Mails", () => {
  it("übernimmt beim ersten Mal die bisherigen Warn-Mails zum Mindestbestand", async () => {
    await updateSettings({
      alertEmailsEnabled: true,
      alertRoles: ["buchhaltung"],
    });
    const mail = await notificationSettings("mail");
    expect(mail.roles["lager.mindestbestand"]).toEqual(["buchhaltung"]);
    expect(mail.roles["rechnung.ueberfaellig"]).toEqual([]);
    // Glocke und Push bleiben, wie sie sind
    expect(
      (await notificationSettings("push")).roles["lager.mindestbestand"].sort(),
    ).toEqual(["admin", "bauleiter"]);
    // Zurücksetzen: die Vorgaben aus dem Katalog
    await resetNotificationSettings();
    expect(
      (await notificationSettings("mail")).roles["lager.mindestbestand"].sort(),
    ).toEqual(["admin", "bauleiter"]);
  });

  it("gehen an die ausgewählten Gruppen und Personen mit E-Mail – abgeschaltet nicht", async () => {
    const chef = await person("geschaeftsfuehrer", "Chef@Firma.at");
    const ohne = await person("geschaeftsfuehrer", null);
    const buero = await person("buchhaltung", "buero@firma.at");
    const partie = await person("partiefuehrer", "partie@firma.at");
    await saveNotificationSettings(
      new Set(["rechnung.ueberfaellig|geschaeftsfuehrer"]),
      new Set([
        `rechnung.ueberfaellig|${buero}`,
        `rechnung.ueberfaellig|${partie}`,
      ]),
      "mail",
    );
    // Partieführer sehen keine Rechnungen – auch persönlich eingetragen nicht
    expect(await mailRecipientsFor({ event: "rechnung.ueberfaellig" })).toEqual(
      ["chef@firma.at", "buero@firma.at"],
    );
    expect(ohne).toBeGreaterThan(0);

    await setMuted(buero, "rechnung.ueberfaellig", true, "mail");
    expect(await mailRecipientsFor({ event: "rechnung.ueberfaellig" })).toEqual(
      ["chef@firma.at"],
    );
    // Der Auslöser bekommt nichts
    expect(
      await mailRecipientsFor({
        event: "rechnung.ueberfaellig",
        actorId: chef,
      }),
    ).toEqual([]);

    // Push abschalten ändert an der Mail nichts – und umgekehrt
    await setMuted(chef, "rechnung.ueberfaellig", true, "push");
    expect(await mailRecipientsFor({ event: "rechnung.ueberfaellig" })).toEqual(
      ["chef@firma.at"],
    );
    const mine = await myNotificationEvents({
      id: buero,
      role: "buchhaltung",
      partyId: null,
    });
    expect(
      mine.mail.find((e) => e.event === "rechnung.ueberfaellig"),
    ).toMatchObject({ muted: true, viaGroup: false });
  });

  it("fest genannte Empfänger bekommen die Mail auch ohne Auswahl", async () => {
    const angelegt = await person("bauleiter", "bau@firma.at");
    expect(await mailRecipientsFor({ event: "angebot.aenderung" })).toEqual([]);
    expect(
      await mailRecipientsFor({
        event: "angebot.aenderung",
        mailUserIds: [angelegt],
      }),
    ).toEqual(["bau@firma.at"]);
  });

  it("verschickt je Person eine Mail mit Link ins Portal", async () => {
    sent.length = 0;
    notify({
      event: "rechnung.ueberfaellig",
      title: "Rechnung 26 001 überfällig",
      body: "Strabag AG · € 120,00",
      url: "/rechnungen/1",
    });
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toMatchObject({
      to: "chef@firma.at",
      subject: "Rechnung 26 001 überfällig",
    });
    expect(sent[0].text).toContain("https://portal.example/rechnungen/1");
    expect(sent[0].text).toContain("Strabag AG");
  });
});

describe("Glocke", () => {
  it('liest eine für alle, die sie bekommen haben – „Alle gelesen" nur die eigenen', async () => {
    const a = await person("bauleiter", null);
    const b = await person("bauleiter", null);
    const c = await person("bauleiter", null);
    const values = (batch: string | null) =>
      [a, b, c].map((userId) => ({
        userId,
        event: "anfrage.neu",
        title: "Neue Anfrage",
        url: "/anfragen/1",
        batch,
      }));
    const rows = await db
      .insert(notifications)
      .values(values("x1"))
      .returning({ id: notifications.id, userId: notifications.userId });
    const own = rows.find((r) => r.userId === a)!;
    await markRead(a, own.id);
    expect((await unreadSummary(b)).unread).toBe(0);
    expect((await unreadSummary(c)).unread).toBe(0);

    await db.insert(notifications).values(values("x2"));
    await markRead(a);
    expect((await unreadSummary(a)).unread).toBe(0);
    expect((await unreadSummary(b)).unread).toBe(1);
  });

  it("räumt gelesene nach 30 Tagen weg, ungelesene erst nach 90", async () => {
    const p = await person("bauleiter", null);
    const day = 86_400_000;
    const now = new Date("2026-10-29T12:00:00Z");
    const at = (days: number) => new Date(now.getTime() - days * day);
    await db.insert(notifications).values([
      {
        userId: p,
        event: "anfrage.neu",
        title: "gelesen, 31 Tage",
        url: "/",
        createdAt: at(31),
        readAt: at(30),
      },
      {
        userId: p,
        event: "anfrage.neu",
        title: "gelesen, 20 Tage",
        url: "/",
        createdAt: at(20),
        readAt: at(20),
      },
      {
        userId: p,
        event: "anfrage.neu",
        title: "ungelesen, 60 Tage",
        url: "/",
        createdAt: at(60),
      },
      {
        userId: p,
        event: "anfrage.neu",
        title: "ungelesen, 91 Tage",
        url: "/",
        createdAt: at(91),
      },
    ]);
    await purgeOldNotifications(now);
    const left = (await listNotifications(p)).map((n) => n.title).sort();
    expect(left).toEqual(["gelesen, 20 Tage", "ungelesen, 60 Tage"]);
  });
});
