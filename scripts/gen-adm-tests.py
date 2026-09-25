#!/usr/bin/env python3
"""Generate two minimal ADM BWF test files for SDA distance/occlusion checks.

distance-test.wav  one frontal object sweeping r = 2.0 -> 0.1 -> 2.0 in 20 s.
occlusion-test.wav A fixed at (0, 0.25, 0); B sweeps the same bearing
                   r = 1.5 -> 0.4 -> 1.5, crossing into A's shadow zone.

48 kHz / 24-bit, one channel per object; axml+chna placed after data.
"""
import math
import struct

RATE = 48000
BLOCK_SECONDS = 0.25

def adm_time(seconds):
    """Format as BS.2076 hh:mm:ss.nffffffff."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    whole = int(seconds)
    fraction = int(round((seconds - whole) * 100000000))
    return f"{hours:02d}:{minutes:02d}:{whole:02d}.{fraction:08d}"

def build_blocks(trajectory, duration):
    blocks = []
    steps = int(round(duration / BLOCK_SECONDS))
    for step in range(steps):
        start = step * BLOCK_SECONDS
        end = min(duration, start + BLOCK_SECONDS)
        x, y, z = trajectory((start + end) / 2)
        blocks.append((start, end, x, y, z))
    return blocks

def build_axml(objects, title):
    channel_formats = []
    packs = []
    stream_formats = []
    track_formats = []
    audio_objects = []
    for track, name, blocks in objects:
        tag = f"{track:04d}"
        cf_id = f"AC_0001{tag}"
        pack_id = f"AP_0001{tag}"
        stream_id = f"AS_0001{tag}"
        track_id = f"AT_0001{tag}"
        object_id = f"AO_0001{tag}"
        block_xml = "".join(
            f'<audioBlockFormat audioBlockFormatID="{cf_id}_{index + 1:08d}" '
            f'rtime="{adm_time(start)}" duration="{adm_time(end - start)}">'
            f"<jumpPosition>1</jumpPosition>"
            f"<cartesian>1</cartesian>"
            f'<position coordinate="X">{x:.9f}</position>'
            f'<position coordinate="Y">{y:.9f}</position>'
            f'<position coordinate="Z">{z:.9f}</position>'
            f"</audioBlockFormat>"
            for index, (start, end, x, y, z) in enumerate(blocks)
        )
        channel_formats.append(
            f'<audioChannelFormat audioChannelFormatID="{cf_id}" '
            f'audioChannelFormatName="{name}_chan" typeLabel="0003" typeDefinition="Objects">'
            f"{block_xml}</audioChannelFormat>"
        )
        packs.append(
            f'<audioPackFormat audioPackFormatID="{pack_id}" '
            f'audioPackFormatName="{name}_pack" typeLabel="0003" typeDefinition="Objects">'
            f"<audioChannelFormatIDRef>{cf_id}</audioChannelFormatIDRef></audioPackFormat>"
        )
        stream_formats.append(
            f'<audioStreamFormat audioStreamFormatID="{stream_id}" '
            f'audioStreamFormatName="{name}_stream" typeLabel="0003" typeDefinition="Objects">'
            f"<audioChannelFormatIDRef>{cf_id}</audioChannelFormatIDRef>"
            f'<audioTrackUID UID="ATU_{track + 1:08d}" typeLabel="0003" typeDefinition="Objects">'
            f"<audioTrackFormatIDRef>{track_id}_01</audioTrackFormatIDRef>"
            f"<audioPackFormatIDRef>{pack_id}</audioPackFormatIDRef>"
            f"</audioTrackUID>"
            f"<audioTrackFormatIDRef>{track_id}_01</audioTrackFormatIDRef>"
            f"<audioPackFormatIDRef>{pack_id}</audioPackFormatIDRef></audioStreamFormat>"
        )
        track_formats.append(
            f'<audioTrackFormat audioTrackFormatID="{track_id}_01" '
            f'audioTrackFormatName="{name}_track" typeLabel="0003" typeDefinition="Objects">'
            f"<audioStreamFormatIDRef>{stream_id}</audioStreamFormatIDRef></audioTrackFormat>"
        )
        audio_objects.append(
            f'<audioObject audioObjectID="{object_id}" audioObjectName="{name}" '
            f'typeLabel="0003" typeDefinition="Objects">'
            f"<audioPackFormatIDRef>{pack_id}</audioPackFormatIDRef>"
            f"<audioTrackUIDRef>ATU_{track + 1:08d}</audioTrackUIDRef>"
            f"</audioObject>"
        )
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<ebuCoreMain xmlns="urn:ebu:metadata-schema:ebuCore_2016" xml:lang="en">'
        "<coreMetadata><format>"
        "<audioFormatExtended>"
        f'<audioProgramme audioProgrammeID="APR_0001" audioProgrammeName="{title}" start="00:00:00.00000" end="00:00:20.00000">'
        "<audioContentIDRef>ACO_0001</audioContentIDRef>"
        "</audioProgramme>"
        '<audioContent audioContentID="ACO_0001" audioContentName="Test">'
        + "".join(
            f"<audioObjectIDRef>AO_0001{track:04d}</audioObjectIDRef>"
            for track, _name, _blocks in objects
        )
        + "</audioContent>"
        + "".join(channel_formats)
        + "".join(packs)
        + "".join(stream_formats)
        + "".join(track_formats)
        + "".join(audio_objects)
        + "</audioFormatExtended>"
        "</format></coreMetadata></ebuCoreMain>"
    )

def build_chna(total_channels, count):
    # chna: numTracks(u16), numEntries(u16), then fixed 40-byte records:
    # trackIndex(u16), audioTrackUID char[12] ("ATU_00000001"), audioTrackFormat
    # char[14] ("AT_00010001_01"), audioPackFormat char[11] ("AP_00010001").
    table = b""
    for track in range(count):
        tag = f"{track:04d}"
        record = struct.pack("<H", track + 1)
        record += f"ATU_{track + 1:08d}".encode("ascii").ljust(12, b"\x00")
        record += f"AT_0001{tag}_01".encode("ascii").ljust(14, b"\x00")
        record += f"AP_0001{tag}".encode("ascii").ljust(11, b"\x00")
        record += b"\x00"  # trailing pad to the fixed 40-byte record
        assert len(record) == 40, len(record)
        table += record
    return struct.pack("<HH", total_channels, count) + table

def write_adm_bwf(path, objects, duration, tones, title):
    total_channels = len(objects)
    frames = int(duration * RATE)
    axml = build_axml(objects, title).encode("utf-8")
    chna = build_chna(total_channels, len(objects))
    # Flute-like sustained tones: soft breath noise + vibrato, slow pentatonic
    # melody so every position of the sweep is held long enough to judge.
    def flute(t, base):
        vibrato = 1.0 + 0.006 * math.sin(2 * math.pi * 5.0 * t)
        tone = math.sin(2 * math.pi * base * vibrato * t)
        tone += 0.18 * math.sin(2 * math.pi * base * 2.0 * vibrato * t)
        tone += 0.07 * math.sin(2 * math.pi * base * 3.0 * t)
        # breath: band-limited-ish noise via two inharmonic sines at low level
        breath = 0.05 * math.sin(2 * math.pi * 1700.0 * t + 3.0 * math.sin(2 * math.pi * 0.7 * t))
        breath += 0.04 * math.sin(2 * math.pi * 2300.0 * t + 1.0)
        # phrase envelope: 150 ms in/out per 5 s note
        note_phase = t % 5.0
        envelope = min(1.0, note_phase / 0.15, (5.0 - note_phase) / 0.3)
        return (tone + breath) * max(0.0, envelope)

    # D minor pentatonic: D4 F4 G4 A4 C5, one note per 5 s.
    melody = [293.66, 349.23, 392.0, 440.0, 523.25]
    note_at = lambda t: melody[int(t / 5.0) % len(melody)]

    pcm = bytearray()
    for frame in range(frames):
        t = frame / RATE
        if total_channels == 1:
            # Solo flute for the distance sweep.
            values = [0.30 * flute(t, note_at(t))]
        else:
            # Occluder: low sustained drone below the flute's register.
            drone = 0.26 * (math.sin(2 * math.pi * 98.0 * t) + 0.3 * math.sin(2 * math.pi * 196.0 * t))
            values = [0.26 * drone, 0.30 * flute(t, note_at(t))]
        for value in values:
            sample = int(max(-1.0, min(1.0, value)) * 8388607)
            pcm += struct.pack("<i", sample)[:3]

    def chunk(cid, payload):
        padding = b"\x00" if len(payload) % 2 else b""
        return cid + struct.pack("<I", len(payload)) + payload + padding

    body = b"WAVE"
    body += chunk(b"fmt ", struct.pack("<HHIIHH", 1, total_channels, RATE, RATE * total_channels * 3, total_channels * 3, 24))
    body += chunk(b"axml", axml)
    body += chunk(b"chna", chna)
    body += chunk(b"data", bytes(pcm))
    riff = b"RIFF" + struct.pack("<I", len(body)) + body
    with open(path, "wb") as handle:
        handle.write(riff)
    print(f"wrote {path}: {total_channels}ch {duration}s axml={len(axml)}B data={len(pcm)}B")

if __name__ == "__main__":
    duration = 20.0

    # 1) Distance sweep: frontal. Approach spends 70% of the time inside the
    #    clearly audible zone (r < 0.7); retreat is quick to make the contrast obvious.
    def distance_trajectory(t):
        phase = t / duration
        if phase <= 0.7:
            # slow exponential-ish approach 0.7 -> 0.06
            radius = 0.06 + (0.7 - 0.06) * (1.0 - phase / 0.7) ** 1.6
        else:
            radius = 0.06 + (0.7 - 0.06) * ((phase - 0.7) / 0.3) ** 0.8
        return (0.0, radius, 0.0)

    distance_objects = [(0, "DistSweep", build_blocks(distance_trajectory, duration))]
    write_adm_bwf("distance-test.wav", distance_objects, duration, [220.0], "SDA distance sweep")

    # 2) Occlusion: A fixed near-frontal; B crosses A's bearing, 1.5 -> 0.4 -> 1.5.
    def occluder_trajectory(_t):
        return (0.0, 0.25, 0.0)

    def victim_trajectory(t):
        phase = t / duration
        radius = 1.0 - 0.7 * (phase / 0.5) if phase <= 0.5 else 0.3 + 0.7 * ((phase - 0.5) / 0.5)
        return (0.0, radius, 0.0)

    occlusion_objects = [
        (0, "OccluderA", build_blocks(occluder_trajectory, duration)),
        (1, "VictimB", build_blocks(victim_trajectory, duration)),
    ]
    write_adm_bwf("occlusion-test.wav", occlusion_objects, duration, [180.0, 720.0], "SDA occlusion pair")
