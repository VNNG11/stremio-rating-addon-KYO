import { addonBuilder, Args, ContentType, serveHTTP } from "stremio-addon-sdk-next";
import { handleMetaRequest } from "./handlers/metaHandler";
import { handleCatalogRequest } from "./handlers/catalogHandler";
import manifest from "./manifest";
import dotenv from "dotenv";
import { closeClient, getClient } from "./repository";
import { get } from "http";

dotenv.config();

const builder = new addonBuilder(manifest);

// Catalog Handlers
builder.defineCatalogHandler(async (args: Args) => {
    console.log("CatalogHandler args:", args);
    await getClient();
    try {
        return await handleCatalogRequest(args);
    } catch (error) {
        console.error("Error in CatalogHandler:", error);
        return { metas: [] };
    } finally{
        console.log("CatalogHandler finally");
        closeClient();
    }
});

// Meta Handlers
builder.defineMetaHandler(async (args: { type: ContentType, id: string }) => {
    await getClient();
    try {
        return { meta: await handleMetaRequest(args) };
    } catch (error) {
        console.error("Error in MetaHandler:", error);
        return { meta: {} as any };
    } finally {
        closeClient();
    }
});

// Additional handlers (stream, subtitle, etc.) can be added similarly
const port = Number(process.env.PORT) || 3000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`🚀 Link for addon http://localhost:${port}`);
