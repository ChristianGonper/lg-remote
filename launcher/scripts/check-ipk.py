#!/usr/bin/env python3
"""Lee un .ipk (ar + tar.gz) y escribe los nombres en JSON. Falla si el tar es ilegible."""
import io
import json
import sys
import tarfile


def read_ar(data):
    if not data.startswith(b"!<arch>\n"):
        raise SystemExit("no es un ar")
    off = 8
    members = []
    while off + 60 <= len(data):
        header = data[off : off + 60]
        if header.strip(b"\0") == b"":
            break
        name = header[0:16].decode("ascii").strip()
        size = int(header[48:58].decode("ascii").strip() or "0")
        off += 60
        body = data[off : off + size]
        if len(body) != size:
            raise SystemExit("miembro truncado: " + name)
        members.append((name, body))
        off += size
        if size % 2 == 1:
            off += 1
    return members


def names(blob):
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        return tf.getnames()


def main():
    data = open(sys.argv[1], "rb").read()
    members = read_ar(data)
    order = [name for name, _body in members]
    if order != ["debian-binary", "control.tar.gz", "data.tar.gz"]:
        raise SystemExit("orden ar inesperado: " + ",".join(order))
    binary = dict(members)["debian-binary"]
    if binary != b"2.0\n":
        raise SystemExit("debian-binary inesperado")
    json.dump(
        {
            "order": order,
            "control": names(dict(members)["control.tar.gz"]),
            "data": names(dict(members)["data.tar.gz"]),
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
