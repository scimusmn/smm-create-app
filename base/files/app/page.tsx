import { templateConfig } from "../lib/template-config";

/**
 * REPLACE THIS PAGE WITH YOUR APP.
 */

const FEATURES = [
  {
    id: "serial",
    title: "Serial communication (Arduino)",
    notes: [
      "Debug page: /serial",
      "Hook: lib/serial/useSerial.ts",
    ],
  },
  {
    id: "sheets-cms",
    title: "Google Sheets CMS",
    notes: [
      "After setting up a Google Sheet, run yarn pull-content to update content/content.json.",
      "mport content through lib/content.ts.",
    ],
  },
  {
    id: "kiosk",
    title: "Kiosk install scripts",
    notes: ["See kiosk/ folder for scripts to install on kiosk computer."],
  },
];

export default function Home() {
  const enabledFeatures = FEATURES.filter((feature) =>
    templateConfig.features.includes(feature.id),
  );

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">
        {templateConfig.product ?? "New project"}
      </h1>
      <p className="mt-2">Replace this page with your project.</p>

      <h2 className="mt-8 text-xl font-semibold">Enabled features</h2>
      {enabledFeatures.length > 0 ? (
        <ul className="mt-4 list-disc space-y-4 pl-6">
          {enabledFeatures.map((feature) => (
            <li key={feature.id}>
              <h3 className="font-semibold">{feature.title}</h3>
              <ul className="list-disc pl-6">
                {feature.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4">No optional features are enabled.</p>
      )}
    </main>
  );
}
