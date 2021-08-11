import type { ExecuteStatementFn } from "./rds";
import { JSONValue } from "replicache";

export async function getCookie(
  executor: ExecuteStatementFn,
  docID: string
): Promise<string> {
  const result = await executor(
    "SELECT UNIX_TIMESTAMP(MAX(LastModified)) FROM Object WHERE DocumentID = :docID",
    {
      docID: { stringValue: docID },
    }
  );
  const version = result.records?.[0]?.[0]?.stringValue;
  return version || "";
}

export async function getLastMutationID(
  executor: ExecuteStatementFn,
  clientID: string,
  lockForUpdate = false,
): Promise<number> {
  const result = await executor(
    `SELECT LastMutationID FROM Client WHERE Id = :id ${lockForUpdate ? 'FOR UPDATE' : ''}`,
    {
      id: { stringValue: clientID },
    }
  );
  return result.records?.[0]?.[0]?.longValue ?? 0;
}

export async function setLastMutationID(
  executor: ExecuteStatementFn,
  clientID: string,
  lastMutationID: number,
  docID: string
): Promise<void> {
  await executor(
    `INSERT INTO Client (Id, LastMutationID, LastCookie, DocumentID) 
    VALUES (:id, :lastMutationID, LastCookie, :docID)
    ON DUPLICATE KEY UPDATE Id = :id, LastMutationID = :lastMutationID, DocumentID = :docID`,
    {
      id: { stringValue: clientID },
      lastMutationID: { longValue: lastMutationID },
      docID: { stringValue: docID },
    }
  );
}

export async function getLastCookie(
  executor: ExecuteStatementFn,
  clientID: string
): Promise<string | null> {
  const result = await executor(
    "SELECT LastCookie FROM Client WHERE Id = :id",
    {
      id: { stringValue: clientID },
    }
  );
  return result.records?.[0]?.[0]?.stringValue ?? null;
}

export async function setLastCookie(
  executor: ExecuteStatementFn,
  clientID: string,
  lastCookie: string,
  docID: string
): Promise<void> {
  await executor(
    "UPDATE Client SET LastCookie = :lastCookie WHERE Id = :id AND DocumentID = :docID",
    {
      id: { stringValue: clientID },
      lastCookie: { stringValue: lastCookie },
      docID: { stringValue: docID },
    }
  );
}

export async function getObject<T extends JSONValue>(
  executor: ExecuteStatementFn,
  documentID: string,
  key: string
): Promise<T | null> {
  const { records } = await executor(
    "SELECT V FROM Object WHERE DocumentID =:docID AND K = :key AND Deleted = False",
    {
      key: { stringValue: key },
      docID: { stringValue: documentID },
    }
  );
  const value = records?.[0]?.[0]?.stringValue;
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

export async function putObject(
  executor: ExecuteStatementFn,
  docID: string,
  key: string,
  value: JSONValue
): Promise<void> {
  await executor(
    `
    INSERT INTO Object (DocumentID, K, V, Deleted)
    VALUES (:docID, :key, :value, False)
      ON DUPLICATE KEY UPDATE V = :value, Deleted = False
    `,
    {
      docID: { stringValue: docID },
      key: { stringValue: key },
      value: { stringValue: JSON.stringify(value) },
    }
  );
}

export async function delObject(
  executor: ExecuteStatementFn,
  docID: string,
  key: string
): Promise<void> {
  await executor(
    `
    UPDATE Object SET Deleted = True
    WHERE DocumentID = :docID AND K = :key
  `,
    {
      docID: { stringValue: docID },
      key: { stringValue: key },
    }
  );
}

export async function delAllShapes(
  executor: ExecuteStatementFn,
  docID: string
): Promise<void> {
  await executor(
    `
    UPDATE Object Set Deleted = True
    WHERE
      DocumentID = :docID AND
      K like 'shape-%'
  `,
    {
      docID: { stringValue: docID },
    }
  );
}

export function storage(executor: ExecuteStatementFn, docID: string) {
  // TODO: When we have the real mysql client, check whether it appears to do
  // this caching internally.
  const cache: {
    [key: string]: { value: JSONValue | undefined; dirty: boolean };
  } = Object.create(null);
  return {
    getObject: async (key: string) => {
      const entry = cache[key];
      if (entry) {
        return entry.value;
      }
      const value = await getObject(executor, docID, key);
      cache[key] = { value, dirty: false };
      return value;
    },
    putObject: async (key: string, value: JSONValue) => {
      cache[key] = { value, dirty: true };
    },
    delObject: async (key: string) => {
      cache[key] = { value: undefined, dirty: true };
    },
    flush: async () => {
      await Promise.all(
        Object.entries(cache)
          .filter(([, { dirty }]) => dirty)
          .map(([k, { value }]) => {
            if (value === undefined) {
              return delObject(executor, docID, k);
            } else {
              return putObject(executor, docID, k, value);
            }
          })
      );
    },
  };
}
