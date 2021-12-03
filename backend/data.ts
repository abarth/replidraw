import { JSONValue } from "replicache";
import { Executor, transact } from "./pg";

export async function createDatabase() {
  await transact(async (executor) => {
    // TODO: Proper versioning for schema.
    await executor("drop table if exists client cascade");
    await executor("drop table if exists object cascade");

    await executor(`create table client (
      id varchar(100) primary key not null,
      lastmutationid int not null)`);

    await executor(`create table object (
      k varchar(100) not null,
      v text not null,
      roomid varchar(100) not null,
      deleted bool not null default false,
      lastmodified timestamp(6) not null,
      unique (roomid, k)
      )`);

    await executor(`create index on object (roomid)`);
    await executor(`create index on object (deleted)`);
    await executor(`create index on object (lastmodified)`);
  });
}

export async function getCookie(
  executor: Executor,
  roomID: string
): Promise<string> {
  const result = await executor(
    "select max(extract(epoch from lastmodified)) from object where roomid = $1",
    [roomID]
  );
  return result.rows[0]?.[result.fields[0].name] ?? "0";
}

export async function getLastMutationID(
  executor: Executor,
  clientID: string
): Promise<number> {
  const result = await executor(
    "select lastmutationid from client where id = $1",
    [clientID]
  );
  return result.rows[0]?.lastmutationid ?? 0;
}

export async function setLastMutationID(
  executor: Executor,
  clientID: string,
  lastMutationID: number
): Promise<void> {
  await executor(
    "insert into client (id, lastmutationid) values ($1, $2) " +
      "on conflict (id) do update set lastmutationid = $2",
    [clientID, lastMutationID]
  );
}

export async function getObject(
  executor: Executor,
  roomid: string,
  key: string
): Promise<JSONValue | undefined> {
  const {
    rows,
  } = await executor(
    "select v from object where roomid = $1 and k = $2 and deleted = false",
    [roomid, key]
  );
  const value = rows[0]?.v;
  if (!value) {
    return undefined;
  }
  return JSON.parse(value);
}

export async function putObject(
  executor: Executor,
  roomID: string,
  key: string,
  value: JSONValue
): Promise<void> {
  await executor(
    `
    insert into object (roomid, k, v, deleted, lastmodified)
    values ($1, $2, $3, false, now())
      on conflict (roomid, k) do update set v = $3, deleted = false, lastmodified = now()
    `,
    [roomID, key, JSON.stringify(value)]
  );
}

export async function delObject(
  executor: Executor,
  roomID: string,
  key: string
): Promise<void> {
  await executor(
    `
    update object set deleted = true, lastmodified = now()
    where roomid = $1 and k = $2
  `,
    [roomID, key]
  );
}
