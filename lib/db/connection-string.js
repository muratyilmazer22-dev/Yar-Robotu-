function secureDatabaseConnectionString(connectionString) {
  const connectionUrl = new URL(connectionString);
  if (connectionUrl.protocol !== "postgres:" && connectionUrl.protocol !== "postgresql:") {
    throw new TypeError("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  connectionUrl.searchParams.set("sslmode", "verify-full");
  return connectionUrl.toString();
}

module.exports = { secureDatabaseConnectionString };
