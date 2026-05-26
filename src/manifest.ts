export const PLUGIN_ID = "uk.digigrow.goofcrypt";

export const manifest = {
    id: PLUGIN_ID,
    version: "1.0.0",
    type: "plugin" as const,
    spec: 3 as const,
    main: "index.js",
    display: {
        name: "GoofCrypt",
        description: "GoofCord-compatible message encryption (StegCloak interop) for Discord mobile.",
        authors: [{ name: "zach" }],
    },
};
