/**
 * TeslaMate vehicles share the vehicle routes with Rivian ones, told apart
 * by this id prefix. Browser-safe: the web app imports it too.
 */
const PREFIX = 'tm-';

export function teslamateVehicleId(carId: number): string {
  return `${PREFIX}${carId}`;
}

export function isTeslaMateVehicle(vehicleId: string | null | undefined): boolean {
  return vehicleId?.startsWith(PREFIX) ?? false;
}

/** TeslaMate's car id for a vehicle id, or null when it isn't one. */
export function teslamateCarId(vehicleId: string): number | null {
  if (!isTeslaMateVehicle(vehicleId)) return null;
  const id = Number(vehicleId.slice(PREFIX.length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
