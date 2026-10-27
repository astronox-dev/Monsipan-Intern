package at.monsipan.fahrzeug;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Gespräch mit dem Portal: koppeln und Standorte schicken */
final class Portal {
    private Portal() {}

    /** Antwort des Portals: HTTP-Status und der Inhalt als JSON (leer, wenn keiner kam) */
    static final class Reply {
        final int status;
        final JSONObject body;

        Reply(int status, JSONObject body) {
            this.status = status;
            this.body = body;
        }

        String message(String fallback) {
            String m = body.optString("message", "");
            return m.isEmpty() ? fallback : m;
        }
    }

    static Reply post(String url, String token, JSONObject payload) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setRequestMethod("POST");
            con.setConnectTimeout(15_000);
            con.setReadTimeout(30_000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("User-Agent", "Monsipan-Fahrzeug/" + BuildConfig.VERSION_NAME);
            if (token != null) con.setRequestProperty("Authorization", "Bearer " + token);
            byte[] data = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = con.getOutputStream()) {
                out.write(data);
            }
            int status = con.getResponseCode();
            InputStream in = status < 400 ? con.getInputStream() : con.getErrorStream();
            JSONObject body = new JSONObject();
            if (in != null) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                in.close();
                try {
                    body = new JSONObject(buf.toString("UTF-8"));
                } catch (JSONException ignored) {
                    // keine JSON-Antwort (etwa eine Fehlerseite)
                }
            }
            return new Reply(status, body);
        } finally {
            con.disconnect();
        }
    }

    static String base(String url) {
        String u = url.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (!u.startsWith("https://") && !u.startsWith("http://")) u = "https://" + u;
        return u;
    }

    /** Koppeln: Code gegen Schlüssel tauschen. Gibt die Fehlermeldung zurück – null heißt gekoppelt. */
    static String pair(Context c, String url, String code) {
        try {
            JSONObject payload = new JSONObject().put("code", code).put("device", Build.MANUFACTURER + " " + Build.MODEL);
            Reply r = post(base(url) + "/api/fahrzeug/koppeln", null, payload);
            if (r.status != 200) return r.message("Koppeln nicht möglich (" + r.status + ").");
            String token = r.body.optString("token", "");
            String vehicle = r.body.optJSONObject("vehicle") != null ? r.body.optJSONObject("vehicle").optString("name", "") : "";
            if (token.isEmpty()) return "Das Portal hat keinen Schlüssel geschickt.";
            Prefs.paired(c, base(url), token, vehicle);
            return null;
        } catch (IOException | JSONException e) {
            return "Keine Verbindung zum Portal – Adresse und Internet prüfen.";
        }
    }

    /**
     * Was in der Warteschlange liegt, in Paketen zu 300 schicken – auch ohne
     * Standorte als Lebenszeichen mit dem Akkustand. Gibt false zurück, wenn das
     * Portal das Tablet nicht mehr kennt (entkoppelt).
     */
    static boolean flush(Context c) {
        String token = Prefs.token(c);
        if (token == null) return false;
        boolean first = true;
        while (true) {
            List<String> lines = Queue.peek(c, 300);
            if (lines.isEmpty() && !first) return true;
            first = false;
            try {
                JSONArray positions = new JSONArray();
                for (String l : lines) {
                    try {
                        positions.put(new JSONObject(l));
                    } catch (JSONException ignored) {
                        // kaputte Zeile – fällt mit dem Paket weg
                    }
                }
                JSONObject payload = new JSONObject().put("positions", positions);
                Intent battery = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (battery != null) {
                    int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
                    if (level >= 0 && scale > 0) payload.put("battery", Math.round(level * 100f / scale));
                    payload.put("charging", plugged != 0);
                }
                Reply r = post(Prefs.url(c) + "/api/fahrzeug/standorte", token, payload);
                if (r.status == 401) {
                    Prefs.unpair(c);
                    Prefs.error(c, r.message("Im Portal entkoppelt."));
                    return false;
                }
                if (r.status != 200) {
                    Prefs.error(c, r.message("Portal antwortet mit " + r.status + "."));
                    return true;
                }
                Queue.drop(c, lines.size());
                Prefs.sent(c);
                if (lines.size() < 300) return true;
            } catch (IOException | JSONException e) {
                Prefs.error(c, "Keine Verbindung – Standorte werden gesammelt und später geschickt.");
                return true;
            }
        }
    }
}
