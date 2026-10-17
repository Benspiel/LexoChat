import { describe, expect, it } from "vitest";
import { generateIdentity, type Identity } from "./keys";
import { broadcastContext, decryptMessage, directContext, encryptMessage, type EncryptedMessage } from "./message";
import { sodium } from "./sodium";

async function setup() {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const eve = await generateIdentity();
  const recipients = [
    { id: "alice", encPublic: alice.encPublic },
    { id: "bob", encPublic: bob.encPublic },
  ];
  const msg = await encryptMessage({
    payload: { t: "text", body: "Patient in Raum 3 wartet." },
    context: directContext("chat1"),
    senderId: "alice",
    senderSignPrivate: alice.signPrivate,
    recipients,
  });
  return { alice, bob, eve, msg };
}

function open(msg: EncryptedMessage, me: Identity, myId: string, sender: Identity, context = directContext("chat1"), senderId = "alice") {
  return decryptMessage({ message: msg, context, senderId, senderSignPublic: sender.signPublic, myId, myEncPublic: me.encPublic, myEncPrivate: me.encPrivate });
}

describe("message encryption", () => {
  it("roundtrips for recipient and sender", async () => {
    const { alice, bob, msg } = await setup();
    expect((await open(msg, bob, "bob", alice)).body).toBe("Patient in Raum 3 wartet.");
    expect((await open(msg, alice, "alice", alice)).body).toBe("Patient in Raum 3 wartet.");
    expect(Object.keys(msg.envelopes).sort()).toEqual(["alice", "bob"]);
    expect(msg.ciphertext).not.toContain("Patient");
  });

  it("third parties cannot read", async () => {
    const { alice, eve, msg } = await setup();
    await expect(open(msg, eve, "eve", alice)).rejects.toThrow(/nicht für Sie/);
    await expect(open(msg, eve, "bob", alice)).rejects.toThrow(/nicht geöffnet/);
  });

  it("detects manipulation of ciphertext, nonce, envelopes and signature", async () => {
    const s = await sodium();
    const { alice, bob, eve, msg } = await setup();
    const flip = (b64: string) => {
      const b = s.from_base64(b64, s.base64_variants.ORIGINAL);
      b[5] = b[5]! ^ 1;
      return s.to_base64(b, s.base64_variants.ORIGINAL);
    };
    await expect(open({ ...msg, ciphertext: flip(msg.ciphertext) }, bob, "bob", alice)).rejects.toThrow(/Signatur/);
    await expect(open({ ...msg, nonce: flip(msg.nonce) }, bob, "bob", alice)).rejects.toThrow(/Signatur/);
    await expect(open({ ...msg, signature: flip(msg.signature) }, bob, "bob", alice)).rejects.toThrow(/Signatur/);
    await expect(open({ ...msg, envelopes: { ...msg.envelopes, eve: "AAAA" } }, bob, "bob", alice)).rejects.toThrow(/Signatur/);
    // forged sender: signature does not match the claimed sender's key
    await expect(open(msg, bob, "bob", eve)).rejects.toThrow(/Signatur/);
  });

  it("binds the message to its chat and sender (no replay into other chats)", async () => {
    const { alice, bob, msg } = await setup();
    await expect(open(msg, bob, "bob", alice, directContext("chat2"))).rejects.toThrow();
    await expect(open(msg, bob, "bob", alice, directContext("chat1"), "bob")).rejects.toThrow();
  });

  it("pads to hide the length", async () => {
    const a = await generateIdentity();
    const r = [{ id: "a", encPublic: a.encPublic }];
    const short = await encryptMessage({ payload: { t: "text", body: "ok" }, context: broadcastContext("a"), senderId: "a", senderSignPrivate: a.signPrivate, recipients: r });
    const longer = await encryptMessage({ payload: { t: "text", body: "ok ".repeat(40) }, context: broadcastContext("a"), senderId: "a", senderSignPrivate: a.signPrivate, recipients: r });
    expect(short.ciphertext.length).toBe(longer.ciphertext.length);
  });

  it("requires the sender as recipient and limits the length", async () => {
    const a = await generateIdentity();
    await expect(encryptMessage({ payload: { t: "text", body: "x" }, context: "c", senderId: "a", senderSignPrivate: a.signPrivate, recipients: [] })).rejects.toThrow();
    await expect(
      encryptMessage({ payload: { t: "text", body: "x".repeat(20_001) }, context: "c", senderId: "a", senderSignPrivate: a.signPrivate, recipients: [{ id: "a", encPublic: a.encPublic }] }),
    ).rejects.toThrow(/zu lang/);
  });
});
