/**
 * The mock's orders, shaped like what Rivian was seen sending (Nov 2026):
 * the delivered order behind the mock vehicle, and for the awaiting-delivery
 * scene an R2 on its way. Every identifier and address is invented.
 */
import type { Delivery, OrderDetail, OrderPayment, OrderSnapshot } from './types.js';

export interface MockOrder {
  snapshot: OrderSnapshot;
  detail: OrderDetail;
  delivery: Delivery | null;
}

const option = (group: string, id: string, name: string) => ({ group, id, name });
const payment = (
  id: string,
  amount: number,
  status: string,
  method: string,
  type: string,
  intent: string,
  date: string,
): OrderPayment => ({ id, amount, status, method, type, intent, date });

/** The order behind the mock vehicle, delivered in spring 2023. */
export function deliveredOrder(vehicleId: string, vin: string): MockOrder {
  return {
    snapshot: {
      id: 'mock-order-r1s',
      state: 'ORDERED',
      configurationStatus: 'SOFT_LOCKED',
      fulfillmentSummaryStatus: 'VEHICLE_DELIVERED',
      vehicleId,
      vin: null,
    },
    detail: {
      id: 'mock-order-r1s',
      type: 'VEHICLE',
      state: 'ORDERED',
      orderDate: '2022-11-08T16:12:40.000Z',
      configurationStatus: 'SOFT_LOCKED',
      fulfillmentSummaryStatus: 'VEHICLE_DELIVERED',
      vehicle: {
        vehicleId,
        vin,
        modelYear: '2023',
        model: 'R1S',
        make: 'RIVIAN',
        plannedBuildDate: '2023-03-10',
        expectedBuildDate: '2023-02-27',
        expectedGeneralAssemblyStartDate: '2023-03-10',
        actualGeneralAssemblyDate: '2023-03-14',
        status: 'DELIVERED',
      },
      items: [
        {
          type: 'VEHICLE',
          title: 'Rivian R1S SUV',
          options: [
            option('V_GEN', 'GEN-1', 'Generation One'),
            option('MODEL_YEAR', '2023', '2023'),
            option('PKG', 'PKG-ADV', 'Adventure trim'),
            option('MOT', 'MOT-401', 'Quad-motor AWD'),
            option('BAT', 'BAT-B01', 'Large battery'),
            option('EXP', 'EXP-FGR', 'Forest Green paint'),
            option('WHL', 'WHL-21RD', '21" Road Dark wheels'),
            option('INT', 'INT-OCB', 'Ocean Coast + Brown Ash Wood interior'),
            option('ROOF', 'ROOF-FGP', 'Panoramic Glass Roof'),
          ],
        },
      ],
      payments: [
        payment(
          'mock-pay-1',
          1000,
          'SUCCEEDED',
          'CARD',
          'DEPOSIT',
          'DEPOSIT',
          '2022-11-08T16:13:02',
        ),
        payment(
          'mock-pay-2',
          89150.5,
          'SUCCEEDED',
          'ACH',
          'BALANCE',
          'PURCHASE',
          '2023-03-28T09:14:00',
        ),
      ],
      estimatedDelivery: null,
    },
    delivery: {
      status: 'DELIVERY_ACCEPTED',
      carrier: 'RIVIAN',
      vin,
      appointment: {
        id: 'mock-appointment-1',
        start: '2023-04-01T10:00:00',
        end: '2023-04-01T10:30:00',
        timeZone: 'America/Chicago',
      },
      address: {
        line1: '1 Example Delivery Way',
        line2: null,
        city: 'Normal',
        state: 'IL',
        zipcode: '61761',
      },
    },
  };
}

/** An R2 built and waiting for its inspection, delivering in nine days. */
export function awaitingOrder(now = new Date()): MockOrder {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
    new Date(now.getTime() + 9 * 86_400_000),
  );
  const vin = '7PDSGABA0TN000002';
  return {
    snapshot: {
      id: 'mock-order-r2',
      state: 'ORDERED',
      configurationStatus: 'SOFT_LOCKED',
      fulfillmentSummaryStatus: 'READY_FOR_FULFILLMENT',
      vehicleId: 'mock-vehicle-r2',
      vin: null,
    },
    detail: {
      id: 'mock-order-r2',
      type: 'VEHICLE',
      state: 'ORDERED',
      orderDate: '2026-04-02T15:20:11.000Z',
      configurationStatus: 'SOFT_LOCKED',
      fulfillmentSummaryStatus: 'READY_FOR_FULFILLMENT',
      vehicle: {
        vehicleId: 'mock-vehicle-r2',
        vin,
        modelYear: '2027',
        model: 'R2',
        make: 'RIVIAN',
        plannedBuildDate: '2026-10-19',
        expectedBuildDate: '2026-10-12',
        expectedGeneralAssemblyStartDate: '2026-10-19',
        actualGeneralAssemblyDate: '2026-10-21',
        status: 'STAGED_FOR_PDI',
      },
      items: [
        {
          type: 'VEHICLE',
          title: 'Rivian R2',
          options: [
            option('V_GEN', 'GEN-1', 'Generation One'),
            option('MODEL_YEAR', '2027', '2027'),
            option('PKG', 'PKG-LE', 'Launch Edition'),
            option('MOT', 'MOT-201', 'Dual-motor AWD'),
            option('BAT', 'BAT-B02', 'Large battery'),
            option('EXP', 'EXP-LGR', 'Launch Green paint'),
            option('WHL', 'WHL-21SP', '21" Sport wheels'),
            option('INT', 'INT-OCN', 'Ocean Coast interior'),
            option('ROOF', 'ROOF-FGP', 'Panoramic Glass Roof'),
            option('CHRG', 'CHRG-NACS01', 'NACS Charging Port'),
          ],
        },
        { type: 'ACCESSORIES', title: 'Rivian Wall Charger', options: [] },
      ],
      payments: [
        payment(
          'mock-pay-3',
          500,
          'SUCCEEDED',
          'CARD',
          'DEPOSIT',
          'DEPOSIT',
          '2026-04-02T15:20:40',
        ),
        payment(
          'mock-pay-4',
          58302.9,
          'PROCESSING',
          'ACH',
          'BALANCE',
          'PURCHASE',
          '2026-10-28T09:14:00',
        ),
      ],
      estimatedDelivery: null,
    },
    delivery: {
      status: 'DELIVERY_ACCEPTED',
      carrier: 'RIVIAN',
      vin,
      appointment: {
        id: 'mock-appointment-2',
        start: `${day}T10:30:00`,
        end: `${day}T11:00:00`,
        timeZone: 'America/Chicago',
      },
      address: {
        line1: '1 Example Delivery Way',
        line2: null,
        city: 'Normal',
        state: 'IL',
        zipcode: '61761',
      },
    },
  };
}
