package at.monsipan.fahrzeug;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Standorte, die noch nicht beim Portal sind – eine Zeile JSON je Standort in
 * einer Datei. Ohne Netz (Tunnel, Funkloch) sammelt sich hier, was später in
 * einem Rutsch nachgeschickt wird. Höchstens rund eine Woche, dann fällt das
 * Älteste weg.
 */
final class Queue {
    private Queue() {}

    private static final int MAX = 25_000;
    private static final Object LOCK = new Object();

    private static File file(Context c) {
        return new File(c.getFilesDir(), "standorte.jsonl");
    }

    static void add(Context c, String line) {
        synchronized (LOCK) {
            try (Writer w = new OutputStreamWriter(new FileOutputStream(file(c), true), StandardCharsets.UTF_8)) {
                w.write(line);
                w.write('\n');
            } catch (IOException ignored) {
                // Speicher voll o. ä. – dieser Standort fehlt dann
            }
            if (file(c).length() > MAX * 140L) trim(c);
        }
    }

    /** Die ältesten bis zu n Zeilen */
    static List<String> peek(Context c, int n) {
        synchronized (LOCK) {
            List<String> out = new ArrayList<>();
            File f = file(c);
            if (!f.exists()) return out;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
                String line;
                while (out.size() < n && (line = r.readLine()) != null) {
                    if (!line.isEmpty()) out.add(line);
                }
            } catch (IOException ignored) {
                // nicht lesbar – nächstes Mal wieder
            }
            return out;
        }
    }

    /** Die ältesten n Zeilen sind beim Portal – weg damit */
    static void drop(Context c, int n) {
        synchronized (LOCK) {
            List<String> rest = all(c);
            write(c, rest.subList(Math.min(n, rest.size()), rest.size()));
        }
    }

    static int size(Context c) {
        synchronized (LOCK) {
            return all(c).size();
        }
    }

    static void clear(Context c) {
        synchronized (LOCK) {
            //noinspection ResultOfMethodCallIgnored
            file(c).delete();
        }
    }

    private static void trim(Context c) {
        List<String> lines = all(c);
        if (lines.size() > MAX) write(c, lines.subList(lines.size() - MAX, lines.size()));
    }

    private static List<String> all(Context c) {
        List<String> out = new ArrayList<>();
        File f = file(c);
        if (!f.exists()) return out;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.isEmpty()) out.add(line);
            }
        } catch (IOException ignored) {
            // nicht lesbar
        }
        return out;
    }

    private static void write(Context c, List<String> lines) {
        File f = file(c);
        File tmp = new File(c.getFilesDir(), "standorte.tmp");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(tmp, false), StandardCharsets.UTF_8)) {
            for (String l : lines) {
                w.write(l);
                w.write('\n');
            }
        } catch (IOException e) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(f);
    }
}
