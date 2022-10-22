const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const { toNanoDate } = require("influx");

const dotenv = require("dotenv");
const axios = require("axios");
const sleep = require("./sleep");

// Load dotenv
dotenv.config();

const envVariables = process.env;

const {
  OCTO_API_KEY,
  OCTO_ELECTRIC_SN,
  OCTO_ELECTRIC_MPAN,
  OCTO_ELECTRIC_COST,
  INFLUXDB_URL,
  INFLUXDB_TOKEN,
  INFLUXDB_ORG,
  INFLUXDB_BUCKET,
  LOOP_TIME,
  PAGE_SIZE,
} = envVariables;

const apiUrl = "https://api.octopus.energy";

const electricResponse = async () => {
  const electricConsumptionApi = `${apiUrl}/v1/electricity-meter-points/${OCTO_ELECTRIC_MPAN}/meters/${OCTO_ELECTRIC_SN}/consumption`;
  const options = {
    auth: { username: OCTO_API_KEY },
  };

  try {
    return axios.get(
      `${electricConsumptionApi}?page_size=${PAGE_SIZE}`,
      options
    );
  } catch (e) {
    console.log("Error retrieving data from octopus API");
    console.log(e);
  }
};

const main = async (callback) => {
  console.log("Starting Octopus Energy Consumption Metrics Container");
  console.log("Current Settings are:");
  console.log(`
        OCTO_API_KEY = ${OCTO_API_KEY}
        OCTO_ELECTRIC_MPAN = ${OCTO_ELECTRIC_MPAN}
        OCTO_ELECTRIC_SN = ${OCTO_ELECTRIC_SN}
        INFLUXDB_URL = ${INFLUXDB_URL}
        INFLUXDB_TOKEN = ${INFLUXDB_TOKEN}
        INFLUXDB_ORG = ${INFLUXDB_ORG}
        INFLUXDB_BUCKET = ${INFLUXDB_BUCKET}
        LOOP_TIME = ${LOOP_TIME}
        OCTO_ELECTRIC_COST = ${OCTO_ELECTRIC_COST}
        PAGE_SIZE = ${PAGE_SIZE}
    `);

  while (true) {
    const client = new InfluxDB({ url: INFLUXDB_URL, token: INFLUXDB_TOKEN });
    const writeApi = client.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET);
    writeApi.useDefaultTags({ app: "octopus-energy-consumption-metrics" });
    console.log("Polling data from octopus API");

    // Retrieve data from octopus API
    const electricresponse = await electricResponse();

    for await (obj of electricresponse.data.results) {
      // Here we take the end interval, and convert it into nanoseconds for influxdb as nodejs works with ms, not ns
      const ts = new Date(obj.interval_end);
      const nanoDate = toNanoDate(String(ts.valueOf()) + "000000");

      // work out the consumption and hard set the datapoint's timestamp to the interval_end value from the API
      let electricpoint = new Point("electricity")
        .floatField("consumption", Number(obj.consumption))
        .timestamp(nanoDate);

      // Same again but for cost mathmatics
      let electriccost =
        (Number(obj.consumption) * Number(OCTO_ELECTRIC_COST)) / 100;
      let electriccostpoint = new Point("electricity_cost")
        .floatField("price", electriccost)
        .timestamp(nanoDate);

      // and then write the points:
      writeApi.writePoint(electricpoint);
      writeApi.writePoint(electriccostpoint);
    }

    await writeApi
      .close()
      .then(() => {
        console.log("Octopus API response submitted to InfluxDB successfully");
      })
      .catch((e) => {
        console.error(e);
        console.log("Error submitting data to InfluxDB");
      });

    // Now sleep for the loop time
    console.log("Sleeping for: " + LOOP_TIME);
    sleep(Number(LOOP_TIME));
  }
};

main((error) => {
  if (error) {
    console.error(error);
    throw error.message || error;
  }
});
