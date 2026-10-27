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
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Läuft dauerhaft im Hintergrund – mit Hinweis in der Statusleiste, wie Android
 * es für ständige Ortung verlangt. Alle 30 Sekunden ein Standort (im Stehen
 * nur, wenn sich das Auto mehr als 15 m bewegt), jede Minute geht gesammelt
 * an das Portal, auch als Lebenszeichen ohne neue Standorte.
 */
public class LocationService extends Service {
    private static final String CHANNEL = "standort";
    private static final int NOTIFICATION_ID = 1;

    private FusedLocationProviderClient fused;
    private ScheduledExecutorService sender;
    private final LocationCallback callback = new LocationCallback() {
        @Override
        public void onLocationResult(LocationResult result) {
            for (Location l : result.getLocations()) store(l);
        }
    };

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
            LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30_000L)
                    .setMinUpdateIntervalMillis(15_000L)
                    .setMinUpdateDistanceMeters(15f)
                    .setMaxUpdateDelayMillis(120_000L)
                    .build();
            try {
                fused.requestLocationUpdates(request, callback, Looper.getMainLooper());
            } catch (SecurityException e) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        if (sender == null) {
            sender = Executors.newSingleThreadScheduledExecutor();
            sender.scheduleWithFixedDelay(() -> {
                // Ein Fehler hier darf den Takt nicht beenden – nächste Minute wieder
                try {
                    if (!Portal.flush(this)) stopSelf();
                } catch (RuntimeException ignored) {
                    Prefs.error(this, "Fehler beim Senden – nächster Versuch in einer Minute.");
                }
            }, 5, 60, TimeUnit.SECONDS);
        }
        return START_STICKY;
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
