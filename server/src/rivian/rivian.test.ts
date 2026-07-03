import { describe, expect, it } from "vitest";
import {
  buildLiveSessionQuery,
  buildVehicleStateQuery,
  buildVehicleStateSubscription,
  SUBSCRIPTION_PROPERTIES,
  VEHICLE_STATE_PROPERTIES,
} from "./graphql.js";
import {
  RivianInvalidOtpError,
  RivianRateLimitError,
  RivianUnauthenticatedError,
  mapGraphqlError,
} from "./types.js";
import { mergeVehicleState } from "../services/state-utils.js";
import type { VehicleState } from "./types.js";

describe("graphql builders", () => {
  it("uses special templates for connection/location fields", () => {
    const query = buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES);
    expect(query).toContain("cloudConnection { lastSync isOnline }");
    expect(query).toContain(
      "gnssLocation { latitude longitude timeStamp isAuthorized }",
    );
    expect(query).toContain("batteryLevel { timeStamp value }");
    expect(query).toContain("$vehicleID: String!");
  });

  it("keeps live tire pressures out of the polling query", () => {
    expect(buildVehicleStateQuery(VEHICLE_STATE_PROPERTIES)).not.toContain(
      "tirePressureFrontLeft ",
    );
    expect(
      buildVehicleStateSubscription(SUBSCRIPTION_PROPERTIES),
    ).toContain("tirePressureFrontLeft { timeStamp value }");
  });

  it("selects value records for live session metrics", () => {
    const query = buildLiveSessionQuery();
    expect(query).toContain("soc { __typename value updatedAt }");
    expect(query).toContain(" chargerId ");
    expect(query).toContain("$vehicleId: ID!");
  });
});

describe("error mapping", () => {
  it("maps UNAUTHENTICATED", () => {
    expect(
      mapGraphqlError([{ extensions: { code: "UNAUTHENTICATED" } }]),
    ).toBeInstanceOf(RivianUnauthenticatedError);
  });

  it("maps invalid OTP variants", () => {
    expect(
      mapGraphqlError([
        { extensions: { code: "BAD_USER_INPUT", reason: "INVALID_OTP" } },
      ]),
    ).toBeInstanceOf(RivianInvalidOtpError);
    expect(
      mapGraphqlError([
        { extensions: { code: "UNAUTHENTICATED", reason: "OTP_TOKEN_EXPIRED" } },
      ]),
    ).toBeInstanceOf(RivianInvalidOtpError);
  });

  it("maps RATE_LIMIT", () => {
    expect(
      mapGraphqlError([{ extensions: { code: "RATE_LIMIT" } }]),
    ).toBeInstanceOf(RivianRateLimitError);
  });
});

describe("mergeVehicleState", () => {
  it("merges deltas and reports changed keys", () => {
    const cached: VehicleState = {
      batteryLevel: { timeStamp: "t0", value: 50 },
    };
    const changed = mergeVehicleState(cached, {
      batteryLevel: { timeStamp: "t1", value: 51 },
      powerState: { timeStamp: "t1", value: "go" },
    });
    expect(changed.sort()).toEqual(["batteryLevel", "powerState"]);
    expect((cached.batteryLevel as { value: unknown }).value).toBe(51);
  });

  it("drops invalid sensor values, keeping the previous one", () => {
    const cached: VehicleState = {
      chargerStatus: { timeStamp: "t0", value: "chrgr_sts_not_connected" },
    };
    const changed = mergeVehicleState(cached, {
      chargerStatus: { timeStamp: "t1", value: "signal_not_available" },
    });
    expect(changed).toEqual([]);
    expect((cached.chargerStatus as { value: unknown }).value).toBe(
      "chrgr_sts_not_connected",
    );
  });

  it("does not report unchanged values", () => {
    const cached: VehicleState = {
      powerState: { timeStamp: "t0", value: "sleep" },
    };
    const changed = mergeVehicleState(cached, {
      powerState: { timeStamp: "t0", value: "sleep" },
    });
    expect(changed).toEqual([]);
  });
});
