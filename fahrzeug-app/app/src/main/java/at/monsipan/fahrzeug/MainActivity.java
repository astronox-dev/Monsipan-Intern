package at.monsipan.fahrzeug;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Der einzige Bildschirm: einmal koppeln (Adresse und Code aus dem Portal),
 * dann Schritt für Schritt die Rechte – Standort, „Immer zulassen",
 * Benachrichtigung, Akku-Ausnahme – und danach nur noch der Stand.
 */
public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 1;
    private static final int REQ_BACKGROUND = 2;
    private static final int REQ_NOTIFY = 3;

    private LinearLayout root;
    /** Das Koppeln steht gerade da – beim Auffrischen nicht neu aufbauen, sonst ist das Getippte weg */
    private boolean pairingShown;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            render();
            handler.postDelayed(this, 5_000);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        LocationService.start(this);
        handler.post(refresh);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refresh);
        super.onPause();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, float size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(Color.parseColor("#1B2027"));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(6), 0, dp(6));
        root.addView(t);
        return t;
    }

    private Button button(String label, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(onClick);
        root.addView(b);
        return b;
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean background() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean notifications() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(Manifest.permission.POST_NOTIFICATIONS);
    }

    private boolean batteryExempt() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    /** Den Bildschirm neu aufbauen – je nachdem, ob gekoppelt und was schon erlaubt ist */
    private void render() {
        boolean paired = Prefs.paired(this);
        if (!paired && pairingShown) return;
        pairingShown = !paired;
        root.removeAllViews();
        text(getString(R.string.app_name), 26, true);

        if (!paired) {
            renderPairing();
            return;
        }
        text("Gekoppelt mit: " + Prefs.vehicle(this), 18, true);
        text("Der Standort dieses Tablets wird rund um die Uhr an das Monsipan Portal gesendet und dort 90 Tage gespeichert.", 15, false);

        if (!LocationService.hasLocation(this)) {
            text("1. Standort erlauben", 17, true);
            button("Standort erlauben", v -> requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION));
            return;
        }
        if (!background()) {
            text("2. Standort „Immer zulassen“ – sonst hört das Tablet auf zu senden, sobald die App nicht offen ist.", 17, true);
            button("Immer zulassen", v -> requestPermissions(new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, REQ_BACKGROUND));
        }
        if (!notifications()) {
            text("Benachrichtigung erlauben – sie zeigt, dass gesendet wird.", 17, true);
            button("Benachrichtigung erlauben", v -> requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY));
        }
        if (!batteryExempt()) {
            text("Akku-Optimierung ausschalten – sonst legt Android die App nach einer Weile schlafen.", 17, true);
            button("Ausnahme erlauben", v -> {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                startActivity(i);
            });
        }

        long last = Prefs.lastSent(this);
        String when = last == 0 ? "noch nicht" : DateFormat.format("dd.MM. HH:mm", last).toString() + " Uhr";
        text("Zuletzt gesendet: " + when, 16, false);
        text("Wartet auf Versand: " + Queue.size(this) + " Standorte", 16, false);
        String error = Prefs.lastError(this);
        if (!error.isEmpty()) {
            TextView t = text(error, 15, false);
            t.setTextColor(Color.parseColor("#BF252C"));
        }
        button("Jetzt senden", v -> new Thread(() -> {
            Portal.flush(this);
            runOnUiThread(this::render);
        }).start());

        View gap = new View(this);
        gap.setMinimumHeight(dp(24));
        root.addView(gap);
        button("Entkoppeln", v -> new AlertDialog.Builder(this)
                .setTitle("Entkoppeln?")
                .setMessage("Das Tablet sendet danach nicht mehr. Zum erneuten Koppeln braucht es einen neuen Code aus dem Portal.")
                .setPositiveButton("Entkoppeln", (d, w) -> {
                    LocationService.stop(this);
                    Prefs.unpair(this);
                    root.removeAllViews();
                    render();
                })
                .setNegativeButton("Abbrechen", null)
                .show());
    }

    private void renderPairing() {
        text("Einmal koppeln: Im Monsipan Portal unter Planung → Fahrzeuge beim Auto auf „Koppeln“ tippen und den Code hier eintragen.", 15, false);
        text("Adresse des Portals", 14, true);
        EditText url = new EditText(this);
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setText(Prefs.url(this));
        root.addView(url);
        text("Code", 14, true);
        EditText code = new EditText(this);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        code.setHint("ABCD-EFGH");
        code.setTextSize(24);
        code.setGravity(Gravity.CENTER);
        root.addView(code);
        TextView status = text(Prefs.lastError(this), 15, false);
        status.setTextColor(Color.parseColor("#BF252C"));
        Button pair = button("Koppeln", null);
        pair.setOnClickListener(v -> {
            pair.setEnabled(false);
            status.setTextColor(Color.parseColor("#4E5561"));
            status.setText("Wird gekoppelt …");
            String u = url.getText().toString();
            String c = code.getText().toString();
            new Thread(() -> {
                String problem = Portal.pair(this, u, c);
                runOnUiThread(() -> {
                    if (problem == null) {
                        root.removeAllViews();
                        render();
                        LocationService.start(this);
                    } else {
                        pair.setEnabled(true);
                        status.setTextColor(Color.parseColor("#BF252C"));
                        status.setText(problem);
                    }
                });
            }).start();
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        LocationService.start(this);
        root.removeAllViews();
        render();
    }
}
