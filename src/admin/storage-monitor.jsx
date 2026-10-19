import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLiveData } from "../use-live-data";

const StorageContext = createContext(null);

// One monitor remains mounted across admin pages; the assistant shares its data.
export function StorageMonitorProvider({ children }) {
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState("");
  const publishSummary = useCallback((data) => {
    setSummary(data);
    setLoadError("");
  }, []);
  const load = useLiveData(
    "/admin/storage",
    publishSummary,
    (error) => setLoadError(error.message),
    30000,
  );
  useEffect(() => {
    window.addEventListener("nxc:print", load);
    return () => window.removeEventListener("nxc:print", load);
  }, [load]);
  return (
    <StorageContext.Provider
      value={{ summary, loadError, load, publishSummary }}
    >
      {children}
    </StorageContext.Provider>
  );
}

export function useStorageMonitor() {
  const monitor = useContext(StorageContext);
  if (!monitor)
    throw new Error(
      "useStorageMonitor must be used inside StorageMonitorProvider",
    );
  return monitor;
}
