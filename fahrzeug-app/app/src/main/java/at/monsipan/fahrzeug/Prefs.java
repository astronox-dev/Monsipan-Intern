package at.monsipan.fahrzeug;

import android.content.Context;
import android.content.SharedPreferences;

/** Was sich die App merkt: Adresse des Portals, Schlüssel vom Koppeln, Fahrzeug, letzter Versand */
final class Prefs {
    private Prefs() {}

    static SharedPreferences of(Context c) {
        return c.getSharedPreferences("fahrzeug", Context.MODE_PRIVATE);
    }

    static String url(Context c) {
        return of(c).getString("url", BuildConfig.PORTAL_URL);
    }

    static String token(Context c) {
        return of(c).getString("token", null);
    }

    static boolean paired(Context c) {
        return token(c) != null;
    }

    static String vehicle(Context c) {
        return of(c).getString("vehicle", "");
    }

    static long lastSent(Context c) {
        return of(c).getLong("lastSent", 0L);
    }

    static String lastError(Context c) {
        return of(c).getString("lastError", "");
    }

    static void paired(Context c, String url, String token, String vehicle) {
        of(c).edit().putString("url", url).putString("token", token).putString("vehicle", vehicle).putString("lastError", "").apply();
    }

    static void sent(Context c) {
        of(c).edit().putLong("lastSent", System.currentTimeMillis()).putString("lastError", "").apply();
    }

    static void error(Context c, String message) {
        of(c).edit().putString("lastError", message).apply();
    }

    /** Entkoppelt (hier oder im Portal): Schlüssel weg, Warteschlange leeren */
    static void unpair(Context c) {
        of(c).edit().remove("token").remove("vehicle").remove("lastSent").apply();
        Queue.clear(c);
    }
}
