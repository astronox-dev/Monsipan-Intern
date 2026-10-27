package at.monsipan.fahrzeug;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Läuft dauerhaft im Hintergrund – mit Hinweis in der Statusleiste, wie Android
 * es für ständige Ortung verlangt. Zwei Gänge:
 * - Fahren: alle 5 Sekunden ein genauer GPS-Standort, damit die Strecke den
 *   Straßen folgt (bei 30 Sekunden schneidet sie Kurven quer ab).
 * - Parken: nach 5 Minuten ohne Fahrt sparsam (etwa jede Minute, über WLAN und
 *   Funk) – das GPS bleibt aus, der Akku hält. Entfernt sich das Tablet mehr
 *   als 150 m oder meldet es Fahrtgeschwindigkeit, geht es zurück ins Fahren.
 * Beim Fahren geht alle 10 Sekunden an das Portal (die Karte dort ist dann
 * fast live), sonst jede Minute – auch als Lebenszeichen ohne neue Standorte.
 */
public class LocationService extends Service {
    private static final String CHANNEL = "standort";
    private static final int NOTIFICATION_ID = 1;

    private static final int FAHREN = 1;
    private static final int PARKEN = 2;
    /** Ab dieser Geschwindigkeit (m/s, rund 11 km/h) fährt das Auto */
    private static final float DRIVE_SPEED = 3f;
    /** So weit vom Abstellort ist es jedenfalls losgefahren (m) */
    private static final float MOVED = 150f;
    private static final long PARK_AFTER = 5 * 60_000L;

    private FusedLocationProviderClient fused;
    private ScheduledExecutorService sender;
    private volatile int mode = 0;
    private volatile long lastMove = System.currentTimeMillis();
    private Location anchor;
    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(LocationResult result) {
            for (Location l : result.getLocations()) {
                store(l);
                follow(l);
            }
        }
    };

    private static LocationRequest request(int m) {
        if (m == FAHREN) {
            return new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
                    .setMinUpdateIntervalMillis(2_000L)
                    .setMinUpdateDistanceMeters(10f)
                    .setWaitForAccurateLocation(true)
                    .build();
        }
        return new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 60_000L)
                .setMinUpdateIntervalMillis(30_000L)
                .setMinUpdateDistanceMeters(50f)
                .build();
    }

    /** In den anderen Gang schalten */
    private void use(int m) {
        if (fused == null || mode == m) return;
        mode = m;
        try {
            fused.removeLocationUpdates(callback);
            fused.requestLocationUpdates(request(m), callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            stopSelf();
        }
    }

    /** Fährt es (oder ist weit weg vom Abstellort), dann Fahren – sonst nach 5 Minuten Parken */
    private void follow(Location l) {
        boolean driving = l.hasSpeed() && l.getSpeed() > DRIVE_SPEED;
        boolean usable = !l.hasAccuracy() || l.getAccuracy() < 100f;
        if (anchor != null && usable && anchor.distanceTo(l) > MOVED) driving = true;
        if (driving) {
            lastMove = l.getTime();
            anchor = l;
            use(FAHREN);
            return;
        }
        if (anchor == null && usable) anchor = l;
        if (mode == FAHREN && l.getTime() - lastMove > PARK_AFTER) use(PARKEN);
    }

    /** Startet den Dienst, wenn gekoppelt und der Standort erlaubt ist */
    static void start(Context c) {
        if (!Prefs.paired(c) || !hasLocation(c)) return;
        Intent i = new Intent(c, LocationService.class);
        c.startForegroundService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, LocationService.class));
    }

    static boolean hasLocation(Context c) {
        return c.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Standort", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Zeigt, dass der Standort an das Monsipan Portal gesendet wird");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIFICATION_ID, n);

        if (!Prefs.paired(this) || !hasLocation(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (fused == null) {
            fused = LocationServices.getFusedLocationProviderClient(this);
            // Erst einmal genau – nach 5 Minuten ohne Fahrt wird es sparsam
            lastMove = System.currentTimeMillis();
            use(FAHREN);
        }
        if (sender == null) {
            sender = Executors.newSingleThreadScheduledExecutor();
            sendIn(5);
        }
        return START_STICKY;
    }

    /** Nächster Versand: beim Fahren nach 10 Sekunden, sonst nach einer Minute */
    private void sendIn(long seconds) {
        ScheduledExecutorService s = sender;
        if (s == null || s.isShutdown()) return;
        try {
            s.schedule(() -> {
                // Ein Fehler hier darf den Takt nicht beenden – es geht danach weiter
                try {
                    if (!Portal.flush(this)) {
                        stopSelf();
                        return;
                    }
                } catch (RuntimeException ignored) {
                    Prefs.error(this, "Fehler beim Senden – nächster Versuch gleich.");
                }
                boolean driving = mode == FAHREN && System.currentTimeMillis() - lastMove < 2 * 60_000L;
                sendIn(driving ? 10 : 60);
            }, seconds, TimeUnit.SECONDS);
        } catch (RejectedExecutionException ignored) {
            // Dienst wird gerade beendet
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String vehicle = Prefs.vehicle(this);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(vehicle.isEmpty() ? getString(R.string.app_name) : vehicle)
                .setContentText("Standort wird an das Monsipan Portal gesendet")
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void store(Location l) {
        try {
            JSONObject p = new JSONObject()
                    .put("t", l.getTime())
                    .put("lat", l.getLatitude())
                    .put("lon", l.getLongitude());
            if (l.hasSpeed()) p.put("spd", l.getSpeed());
            if (l.hasBearing()) p.put("hdg", l.getBearing());
            if (l.hasAccuracy()) p.put("acc", l.getAccuracy());
            Queue.add(this, p.toString());
        } catch (JSONException ignored) {
            // kann bei Zahlen nicht passieren
        }
    }

    @Override
    public void onDestroy() {
        if (fused != null) fused.removeLocationUpdates(callback);
        if (sender != null) sender.shutdownNow();
        fused = null;
        sender = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
