package com.justicemw.ocean_live.pkc;

import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Phone-as-key BLE unlock wire format for the vehicle's digital-key BLE module.
 *
 * This is an original implementation of a documented shape: a per-session BLE
 * service UUID derived from an HMAC, and command frames authenticated with
 * HMAC-SHA256 over a vehicle access (VA) key, a rolling random value supplied
 * by the vehicle, and a monotonic freshness counter. The HMAC itself is the
 * standard, public HMAC-SHA256 construction (RFC 2104), computed here with
 * the JDK's own javax.crypto.Mac rather than any vendor's bundled code - no
 * third-party SDK source went into this file. Only the *shape* of the frame
 * (which fields, in which order, at which lengths) reflects what was observed
 * of the vehicle's own BLE module behavior, which this app needs to
 * interoperate with to unlock a car the user owns.
 */
public final class PkcProtocol {
    private PkcProtocol() {}

    /** Fixed 6-byte salt mixed into the advertising-identifier HMAC. */
    private static final byte[] ADVERTISING_SALT = {0x3A, (byte) 0xAF, 0x7D, (byte) 0xE2, 0x5B, (byte) 0x88};

    /** GATT service UUID prefix; the last 12 hex chars are per-session. */
    public static final String SERVICE_UUID_PREFIX = "15230e82-1212-ca75-1523-";

    /** Single read/write/notify characteristic, fixed across sessions. */
    public static final String CHARACTERISTIC_UUID = "15240e82-1212-ca75-1523-785feabcd123";

    /** Incoming-frame header byte: vehicle is handing the phone a new session nonce. */
    public static final int HEADER_RANDOM_NUMBER_UPDATE = 0x10;

    /** Outgoing command-type byte for a vehicle body command (lock/unlock/etc). */
    public static final int COMMAND_TYPE_VEHICLE = 0x00;

    /** Outgoing command-type byte for ending the session. */
    public static final int COMMAND_TYPE_DISCONNECT = 0x18;

    public static final byte[] CMD_LOCK = {0x00, 0x04};
    public static final byte[] CMD_UNLOCK = {0x00, 0x08};

    /** Parses a 32-hex-character VA key into its 16 raw bytes. Throws if malformed. */
    public static byte[] vaKeyToBytes(String vaKeyHex) {
        if (vaKeyHex == null || vaKeyHex.length() != 32 || !vaKeyHex.matches("[0-9a-fA-F]{32}")) {
            throw new IllegalArgumentException("VA key must be exactly 32 hex characters");
        }
        byte[] out = new byte[16];
        for (int i = 0; i < 16; i++) {
            out[i] = (byte) Integer.parseInt(vaKeyHex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static byte[] hmacSha256(byte[] message, byte[] key) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /**
     * The 12 lowercase hex characters that both the per-session advertised
     * service UUID suffix and (per the observed protocol) a companion
     * passphrase are derived from: the first 6 bytes of
     * HMAC-SHA256(ADVERTISING_SALT, vaKeyBytes), byte-reversed.
     */
    public static String deriveSessionId(byte[] vaKeyBytes) {
        byte[] digest = hmacSha256(ADVERTISING_SALT, vaKeyBytes);
        StringBuilder sb = new StringBuilder(12);
        for (int i = 5; i >= 0; i--) {
            sb.append(String.format(Locale.ROOT, "%02x", digest[i] & 0xFF));
        }
        return sb.toString();
    }

    public static String serviceUuidFor(String sessionId) {
        return SERVICE_UUID_PREFIX + sessionId;
    }

    /**
     * Builds an authenticated outgoing frame:
     * commandType(1) + len(1) + command(n) + randomNumber(4, from vehicle) +
     * freshness(2, little-endian) + HMAC-SHA256(all of the above, vaKeyBytes)(32).
     */
    public static byte[] buildOutgoingFrame(int commandType, byte[] command, byte[] randomNumber, int freshness, byte[] vaKeyBytes) {
        if (randomNumber == null || randomNumber.length != 4) {
            throw new IllegalStateException("No session random number from the vehicle yet");
        }
        byte[] body = new byte[2 + command.length + 4 + 2];
        int i = 0;
        body[i++] = (byte) commandType;
        body[i++] = (byte) command.length;
        System.arraycopy(command, 0, body, i, command.length);
        i += command.length;
        System.arraycopy(randomNumber, 0, body, i, 4);
        i += 4;
        body[i++] = (byte) (freshness & 0xFF);
        body[i] = (byte) ((freshness >> 8) & 0xFF);

        byte[] mac = hmacSha256(body, vaKeyBytes);
        byte[] frame = new byte[body.length + mac.length];
        System.arraycopy(body, 0, frame, 0, body.length);
        System.arraycopy(mac, 0, frame, body.length, mac.length);
        return frame;
    }

    /** Result of parsing an inbound characteristic write from the vehicle. */
    public static final class IncomingFrame {
        public final int header;
        public final byte[] payload;
        public IncomingFrame(int header, byte[] payload) {
            this.header = header;
            this.payload = payload;
        }
    }

    /** Parses header(1) + length(1) + payload(length) from the vehicle. Returns null if too short. */
    public static IncomingFrame parseIncomingFrame(byte[] value) {
        if (value == null || value.length < 2) return null;
        int header = value[0] & 0xFF;
        int len = value[1] & 0xFF;
        int available = value.length - 2;
        int take = Math.min(len, available);
        byte[] payload = new byte[take];
        System.arraycopy(value, 2, payload, 0, take);
        return new IncomingFrame(header, payload);
    }
}
