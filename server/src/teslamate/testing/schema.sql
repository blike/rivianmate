-- The parts of TeslaMate's schema RivianMate reads, with TeslaMate's column
-- types (UTC times in `timestamp` columns, numeric ranges), for tests.
CREATE TYPE states_status AS ENUM ('online', 'offline', 'asleep');
CREATE TYPE range AS ENUM ('ideal', 'rated');

CREATE TABLE settings (
  id bigserial PRIMARY KEY,
  preferred_range range NOT NULL DEFAULT 'rated'
);

CREATE TABLE cars (
  id smallserial PRIMARY KEY,
  eid bigint NOT NULL,
  vid bigint NOT NULL,
  model character varying(255),
  efficiency double precision,
  vin text,
  name text,
  trim_badging text,
  marketing_name character varying(255),
  inserted_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id serial PRIMARY KEY,
  display_name character varying(512),
  latitude numeric(8,6),
  longitude numeric(9,6),
  name character varying(255),
  house_number character varying(255),
  road character varying(255),
  neighbourhood character varying(255),
  city character varying(255),
  county character varying(255),
  postcode character varying(255),
  state character varying(255),
  country character varying(255)
);

CREATE TABLE geofences (
  id serial PRIMARY KEY,
  name character varying(255) NOT NULL,
  latitude numeric(8,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  radius smallint NOT NULL DEFAULT 25
);

CREATE TABLE drives (
  id serial PRIMARY KEY,
  start_date timestamp NOT NULL,
  end_date timestamp,
  outside_temp_avg numeric(4,1),
  speed_max smallint,
  power_max smallint,
  power_min smallint,
  start_ideal_range_km numeric(6,2),
  end_ideal_range_km numeric(6,2),
  start_km double precision,
  end_km double precision,
  distance double precision,
  duration_min smallint,
  car_id smallint NOT NULL REFERENCES cars(id),
  inside_temp_avg numeric(4,1),
  start_address_id integer REFERENCES addresses(id),
  end_address_id integer REFERENCES addresses(id),
  start_rated_range_km numeric(6,2),
  end_rated_range_km numeric(6,2),
  start_position_id integer,
  end_position_id integer,
  start_geofence_id integer REFERENCES geofences(id),
  end_geofence_id integer REFERENCES geofences(id),
  ascent smallint,
  descent smallint
);

CREATE TABLE positions (
  id serial PRIMARY KEY,
  date timestamp NOT NULL,
  latitude numeric(8,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  speed smallint,
  power smallint,
  odometer double precision,
  ideal_battery_range_km numeric(6,2),
  battery_level smallint,
  outside_temp numeric(4,1),
  elevation smallint,
  fan_status integer,
  driver_temp_setting numeric(4,1),
  passenger_temp_setting numeric(4,1),
  is_climate_on boolean,
  is_rear_defroster_on boolean,
  is_front_defroster_on boolean,
  car_id smallint NOT NULL REFERENCES cars(id),
  drive_id integer REFERENCES drives(id),
  inside_temp numeric(4,1),
  battery_heater_on boolean,
  battery_heater boolean,
  battery_heater_no_power boolean,
  est_battery_range_km numeric(6,2),
  rated_battery_range_km numeric(6,2),
  usable_battery_level smallint,
  tpms_pressure_fl numeric(4,1),
  tpms_pressure_fr numeric(4,1),
  tpms_pressure_rl numeric(4,1),
  tpms_pressure_rr numeric(4,1)
);

CREATE TABLE charging_processes (
  id serial PRIMARY KEY,
  start_date timestamp NOT NULL,
  end_date timestamp,
  charge_energy_added numeric(8,2),
  start_ideal_range_km numeric(6,2),
  end_ideal_range_km numeric(6,2),
  start_battery_level smallint,
  end_battery_level smallint,
  duration_min smallint,
  outside_temp_avg numeric(4,1),
  car_id smallint NOT NULL REFERENCES cars(id),
  position_id integer NOT NULL REFERENCES positions(id),
  address_id integer REFERENCES addresses(id),
  start_rated_range_km numeric(6,2),
  end_rated_range_km numeric(6,2),
  geofence_id integer REFERENCES geofences(id),
  charge_energy_used numeric(8,2),
  cost numeric(6,2)
);

CREATE TABLE charges (
  id serial PRIMARY KEY,
  date timestamp NOT NULL,
  battery_heater_on boolean,
  battery_level smallint,
  charge_energy_added numeric(8,2) NOT NULL,
  charger_actual_current smallint,
  charger_phases smallint,
  charger_pilot_current smallint,
  charger_power smallint NOT NULL,
  charger_voltage smallint,
  fast_charger_present boolean,
  conn_charge_cable character varying(255),
  fast_charger_brand character varying(255),
  fast_charger_type character varying(255),
  ideal_battery_range_km numeric(6,2) NOT NULL,
  not_enough_power_to_heat boolean,
  outside_temp numeric(4,1),
  charging_process_id integer NOT NULL REFERENCES charging_processes(id),
  battery_heater boolean,
  battery_heater_no_power boolean,
  rated_battery_range_km numeric(6,2),
  usable_battery_level smallint
);

CREATE TABLE states (
  id serial PRIMARY KEY,
  state states_status NOT NULL,
  start_date timestamp NOT NULL,
  end_date timestamp,
  car_id smallint NOT NULL REFERENCES cars(id)
);

CREATE TABLE updates (
  id serial PRIMARY KEY,
  start_date timestamp NOT NULL,
  end_date timestamp,
  version character varying(255),
  car_id smallint NOT NULL REFERENCES cars(id)
);
