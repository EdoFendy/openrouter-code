import { useEffect, useState } from "react";
import { useStdout } from "ink";

export type TerminalDimensions = {
  columns: number;
  rows: number;
};

const FALLBACK: TerminalDimensions = { columns: 100, rows: 30 };

export function useTerminalDimensions(): TerminalDimensions {
  const { stdout } = useStdout();
  const [dim, setDim] = useState<TerminalDimensions>(() => readDim(stdout));

  useEffect(() => {
    if (!stdout) {
      return;
    }

    const onResize = (): void => setDim(readDim(stdout));
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return dim;
}

function readDim(stdout: NodeJS.WriteStream | undefined): TerminalDimensions {
  if (!stdout) {
    return FALLBACK;
  }

  const columns = typeof stdout.columns === "number" && stdout.columns > 0 ? stdout.columns : FALLBACK.columns;
  const rows = typeof stdout.rows === "number" && stdout.rows > 0 ? stdout.rows : FALLBACK.rows;
  return { columns, rows };
}
