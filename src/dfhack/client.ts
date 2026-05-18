import * as net from "net";
import protobuf from "protobufjs";
import {
  createHandshakeRequest,
  validateHandshakeResponse,
  encodeMessage,
  decodeHeader,
  RPC_REPLY_RESULT,
  RPC_REPLY_FAIL,
  RPC_REPLY_TEXT,
  RPC_REQUEST_QUIT,
  CR_WRONG_USAGE,
  CR_NOT_FOUND,
  CR_NOT_IMPLEMENTED,
  CR_LINK_FAILURE,
  type DwarfMessage,
} from "./codec.js";
import {
  lookupType,
  getAllMethodDefs,
  type BoundMethod,
} from "./methods.js";

export class DFHackRPCError extends Error {
  constructor(
    message: string,
    public methodName: string,
    public code?: number,
  ) {
    super(message);
    this.name = "DFHackRPCError";
  }
}

function buildFailureMessage(methodName: string, code?: number): string {
  let reason = "";
  if (code === CR_WRONG_USAGE) {
    if (methodName === "RunLua") {
      reason = ` (RunLua requires module names matching "rpc.*", "*.rpc", or "*-rpc")`;
    } else {
      reason = ` (wrong arguments or usage — code: ${code})`;
    }
  } else if (code === CR_NOT_FOUND) {
    reason = ` (target not found — the plugin may not be loaded)`;
  } else if (code === CR_NOT_IMPLEMENTED) {
    reason = ` (not implemented — DFHack plugin may be missing)`;
  } else if (code === CR_LINK_FAILURE) {
    reason = ` (I/O or protocol error)`;
  } else if (code !== undefined) {
    reason = ` (code: ${code})`;
  }
  return `RPC call to ${methodName} failed${reason}`;
}

function getConfigHost(): string {
  return process.env.DFHACK_HOST ?? "127.0.0.1";
}

function getConfigPort(): number {
  return parseInt(process.env.DFHACK_PORT ?? "5000", 10);
}

export type ConnectionStatus = "disconnected" | "connecting" | "handshaking" | "binding" | "ready" | "error";

const MAX_BUFFER_SIZE = 64 * 1024 * 1024;

export class DFHackClient {
  private socket: net.Socket | null = null;
  private recvBuffer = Buffer.alloc(0);
  private pendingResolve: ((msgs: DwarfMessage[]) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private pendingTimedOut = false;
  private textMessages: DwarfMessage[] = [];
  private methods = new Map<string, BoundMethod>();
  private _status: ConnectionStatus = "disconnected";
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  get status(): ConnectionStatus {
    return this._status;
  }

  get availableMethods(): string[] {
    return Array.from(this.methods.keys());
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  onStatusChange(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.push(listener);
  }

  async connect(host?: string, port?: number): Promise<void> {
    const h = host ?? getConfigHost();
    const p = port ?? getConfigPort();

    if (this._status !== "disconnected") {
      throw new Error(`Cannot connect: current status is ${this._status}`);
    }

    this.setStatus("connecting");

    try {
      await this.doConnect(h, p);
      this.setStatus("handshaking");

      // Wait for handshake response
      const handshakeData = await this.readRawUntil(12);
      if (!validateHandshakeResponse(handshakeData)) {
        throw new Error("Invalid handshake response from DFHack");
      }

      this.setStatus("binding");

      // Bind all RPC methods
      await this.bindAllMethods();

      this.setStatus("ready");
    } catch (err) {
      this.setStatus("error");
      this.socket?.destroy();
      this.socket = null;
      throw err;
    }
  }

  private doConnect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.on("data", (data: Buffer) => this.onData(data));
      this.socket.on("error", (err: Error) => {
        this.setStatus("error");
        this.cleanupReadRaw(err);
        reject(err);
      });
      this.socket.on("close", () => {
        if (this._status !== "disconnected") {
          this.setStatus("disconnected");
        }
        this.cleanupPending(new Error("Connection closed"));
        this.cleanupReadRaw(new Error("Connection closed"));
      });

      this.socket.connect(port, host, () => {
        this.socket!.write(createHandshakeRequest());
        resolve();
      });
    });
  }

  private readRawResolve: ((data: Buffer) => void) | null = null;
  private readRawReject: ((err: Error) => void) | null = null;
  private readRawBuffer = Buffer.alloc(0);
  private readRawTarget = 0;

  private readRawUntil(bytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.recvBuffer.length >= bytes) {
        const result = Buffer.from(this.recvBuffer.subarray(0, bytes));
        this.recvBuffer = this.recvBuffer.subarray(bytes);
        resolve(result);
        return;
      }
      this.readRawTarget = bytes;
      this.readRawBuffer = Buffer.from(this.recvBuffer);
      this.recvBuffer = Buffer.alloc(0);
      this.readRawResolve = resolve;
      this.readRawReject = reject;
    });
  }

  private onData(data: Buffer): void {
    if (this.readRawResolve) {
      this.readRawBuffer = Buffer.concat([this.readRawBuffer, data]);
      if (this.readRawBuffer.length >= this.readRawTarget) {
        const result = Buffer.from(this.readRawBuffer.subarray(0, this.readRawTarget));
        this.recvBuffer = Buffer.concat([
          this.readRawBuffer.subarray(this.readRawTarget),
          this.recvBuffer,
        ]);
        this.readRawBuffer = Buffer.alloc(0);
        this.readRawTarget = 0;
        const resolve = this.readRawResolve;
        this.readRawResolve = null;
        this.readRawReject = null;
        resolve(result);
      }
      return;
    }

    this.recvBuffer = Buffer.concat([this.recvBuffer, data]);

    if (this.recvBuffer.length > MAX_BUFFER_SIZE) {
      this.recvBuffer = Buffer.alloc(0);
      const err = new Error(`Receive buffer exceeded ${MAX_BUFFER_SIZE} bytes — possible protocol desync`);
      this.cleanupPending(err);
      this.cleanupReadRaw(err);
      this.socket?.destroy();
      this.setStatus("error");
      return;
    }

    this.tryParseMessages();
  }

  private tryParseMessages(): void {
    const collected: DwarfMessage[] = [];

    while (true) {
      if (this.recvBuffer.length < 8) break;

      const header = decodeHeader(this.recvBuffer);
      if (!header) break;

      const { id, size } = header;

      if (id === RPC_REPLY_FAIL) {
        this.recvBuffer = this.recvBuffer.subarray(8);
        const failMsg: DwarfMessage = { id, data: new Uint8Array(0), failureCode: size };
        collected.push(failMsg);
        break;
      }

      if (id === RPC_REPLY_TEXT) {
        if (this.recvBuffer.length < 8 + size) break;
        const msgData = new Uint8Array(this.recvBuffer.subarray(8, 8 + size));
        this.recvBuffer = this.recvBuffer.subarray(8 + size);
        this.textMessages.push({ id, data: msgData });
        continue;
      }

      if (id === RPC_REPLY_RESULT) {
        if (this.recvBuffer.length < 8 + size) break;
        const msgData = new Uint8Array(this.recvBuffer.subarray(8, 8 + size));
        this.recvBuffer = this.recvBuffer.subarray(8 + size);
        collected.push({ id, data: msgData });
        continue;
      }

      // Unknown message type - skip header
      this.recvBuffer = this.recvBuffer.subarray(8);
      break;
    }

    if (collected.length > 0 && this.pendingResolve) {
      const allMsgs = [...this.textMessages.splice(0), ...collected];
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve(allMsgs);
    } else if (collected.length > 0 && this.pendingTimedOut) {
      console.error("[vizier-mcp] Dropping late response after timeout");
      this.textMessages = [];
    }
  }

  private cleanupPending(err: Error): void {
    if (this.pendingReject) {
      this.pendingReject(err);
    }
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingTimedOut = false;
  }

  private cleanupReadRaw(err: Error): void {
    if (this.readRawReject) {
      this.readRawReject(err);
    }
    this.readRawResolve = null;
    this.readRawReject = null;
    this.readRawBuffer = Buffer.alloc(0);
    this.readRawTarget = 0;
  }

  private async sendRecv(msg: DwarfMessage, timeoutMs: number = 30000): Promise<DwarfMessage[]> {
    if (!this.socket || (this._status !== "ready" && this._status !== "binding")) {
      throw new Error(`Not connected (status: ${this._status})`);
    }

    if (this.pendingResolve) {
      throw new Error("Concurrent RPC call attempted — only one call allowed at a time");
    }

    return new Promise<DwarfMessage[]>((resolve, reject) => {
      this.textMessages = [];
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.socket!.write(encodeMessage(msg));

      const timer = setTimeout(() => {
        this.pendingTimedOut = true;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(new Error(`RPC call timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const origResolve = this.pendingResolve;
      this.pendingResolve = (msgs: DwarfMessage[]) => {
        clearTimeout(timer);
        origResolve(msgs);
      };

      const origReject = this.pendingReject;
      this.pendingReject = (err: Error) => {
        clearTimeout(timer);
        origReject(err);
      };
    });
  }

  private async bindAllMethods(): Promise<void> {
    const bindType = lookupType("dfproto.CoreBindRequest");
    const bindOutputType = lookupType("dfproto.CoreBindReply");

    // BindMethod has ID 0, but we need to first bind it itself
    // Actually BindMethod IS ID 0 already, so we just call it

    const allDefs = getAllMethodDefs();

    for (const def of allDefs) {
      try {
        const inputType = lookupType(def.inputType);
        const outputType = lookupType(def.outputType);

        const bindReq = bindType.create({
          method: def.name,
          inputMsg: def.inputType,
          outputMsg: def.outputType,
          plugin: def.plugin,
        });
        const bindData = bindType.encode(bindReq as protobuf.Message).finish();

        const msgs = await this.sendRecv({ id: 0, data: bindData });

        if (msgs.length === 0 || msgs[msgs.length - 1].id === RPC_REPLY_FAIL) {
          const code = msgs.length > 0 ? msgs[msgs.length - 1].failureCode : undefined;
          console.error(`[vizier-mcp] Failed to bind method ${def.name}${def.plugin ? ` (plugin: ${def.plugin})` : ""}${code !== undefined ? ` — result code: ${code}` : ""}`);
          continue;
        }

        const lastMsg = msgs[msgs.length - 1];
        const bindReply = bindOutputType.toObject(bindOutputType.decode(lastMsg.data));

        this.methods.set(def.name, {
          id: bindReply.assignedId as number,
          inputType,
          outputType,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[vizier-mcp] Failed to bind method ${def.name}${def.plugin ? ` (plugin: ${def.plugin})` : ""}: ${msg}`);
        continue;
      }
    }
  }

  async callTyped<T>(methodName: string, input?: Record<string, unknown>): Promise<T> {
    return this.call(methodName, input) as unknown as T;
  }

  async call(methodName: string, input?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const method = this.methods.get(methodName);
    if (!method) {
      const available = this.availableMethods.join(", ");
      throw new DFHackRPCError(
        `Method not available: ${methodName}. Available methods: ${available}. The DFHack plugin may not be loaded, or the method failed to bind earlier.`,
        methodName,
      );
    }

    const req = method.inputType.create(input ?? {});
    const data = method.inputType.encode(req as protobuf.Message).finish();

    const msgs = await this.sendRecv({ id: method.id, data });

    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.id === RPC_REPLY_FAIL) {
      const code = lastMsg?.failureCode;
      throw new DFHackRPCError(
        buildFailureMessage(methodName, code),
        methodName,
        code,
      );
    }

    return method.outputType.toObject(method.outputType.decode(lastMsg.data)) as Record<string, unknown>;
  }

  disconnect(): void {
    if (this.socket && this._status === "ready") {
      try {
        const quitMsg: DwarfMessage = { id: RPC_REQUEST_QUIT, data: new Uint8Array(0) };
        this.socket.write(encodeMessage(quitMsg));
      } catch {
        // ignore write errors during disconnect
      }
    }

    this.setStatus("disconnected");
    this.cleanupPending(new Error("Disconnected"));
    this.cleanupReadRaw(new Error("Disconnected"));

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

let sharedClient: DFHackClient | null = null;
let connectPromise: Promise<DFHackClient> | null = null;

export async function getClient(): Promise<DFHackClient> {
  if (sharedClient && sharedClient.status === "ready") {
    return sharedClient;
  }

  if (connectPromise) {
    return connectPromise;
  }

  if (sharedClient) {
    sharedClient.disconnect();
    sharedClient = null;
  }

  const maxRetries = 3;
  const baseDelayMs = 1000;

  connectPromise = (async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const client = new DFHackClient();
      try {
        await client.connect();

        client.onStatusChange((status) => {
          if ((status === "disconnected" || status === "error") && sharedClient === client) {
            sharedClient = null;
            connectPromise = null;
          }
        });

        sharedClient = client;
        connectPromise = null;
        if (attempt > 0) {
          console.error(`[vizier-mcp] Reconnected successfully on attempt ${attempt + 1}`);
        }
        return client;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.error(`[vizier-mcp] Connection attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    connectPromise = null;
    throw new Error(`Failed to connect after ${maxRetries} attempts: ${lastError?.message}`);
  })();

  return connectPromise;
}

export function disconnectClient(): void {
  if (sharedClient) {
    sharedClient.disconnect();
    sharedClient = null;
    connectPromise = null;
  }
}
