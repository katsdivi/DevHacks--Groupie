export const env = {
  port: Number(process.env.PORT ?? 3000),
  devMode: process.env.DEV_MODE === 'true',
  publicUrl: process.env.PUBLIC_URL ?? '',
  databasePath: process.env.DATABASE_PATH ?? './data/groupie.db',
};
