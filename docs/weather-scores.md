# Weather scores: what "comfortable" means beyond temperature

Every threshold lives once, in `RULES` in `src/core/weather-days.ts`; this page explains where each comes from.

## 1. The question

"Comfortable" is more than temperature. WeatherSpark's tourism score ("clear, rainless days with perceived temperatures between 18 °C and 27 °C") and its beach/pool score are good models; this page surveys the other scores in use and keeps the good ones: a small family, each a count of days with a one-sentence definition, computable from hourly open data. Per city and month the app also shows average highs and lows, the 10th and 90th percentiles of daily highs and lows, and the lowest low and highest high, in the temperature chart beside the comfortable band.

## 2. What exists

Read first-hand unless marked otherwise.

| Score | What it measures | Inputs | Fit for choosing where to live |
|---|---|---|---|
| **WeatherSpark tourism score** | How pleasant each day of the year is for general outdoor activities, 0-10. Hourly scores 8 am to 9 pm for cloud (10 clear, 9 mostly clear, 1 overcast), rain (10 none, 0 at 1 mm in three hours) and perceived temperature (0 below 10 °C, 9 at 18, 10 at 24, 9 at 27, 1 at 32 °C or more), combined into a composite, averaged over 1980-2016 and smoothed. Source: the methodology section on any city page, e.g. [London](https://weatherspark.com/y/45062/Average-Weather-in-London-United-Kingdom-Year-Round), read once through a person's browser (the site blocks scripts). | Hourly perceived temperature, cloud, precipitation (MERRA-2) | Good idea, wrong form for us: a smoothed 0-10 curve is not readable in one sentence and its range cannot be edited live. We keep its tests, start the range at 18-30 °C feels-like and count days instead. |
| **WeatherSpark beach/pool score** | The same with a hotter temperature score: 0 below 18 °C, 9 at 24, 10 at 28, 9 at 32, 1 at 38 °C or more. Same source. | Same | Kept as **Beach days**. |
| **Tourism Climate Index (TCI)**, Mieczkowski 1985 | A 0-100 monthly index: daytime comfort (40%), daily comfort (10%), rain (20%), sunshine (20%), wind (10%). Weights and scales were the author's judgement (criticism read in Scott et al. 2016, below). | Monthly means of temperature, humidity, rain, sunshine, wind | Not used: monthly averages hide whether rain falls on a few days or every day, and it needs sunshine hours, which we only have from stations. |
| **Holiday Climate Index (HCI:Urban)**, Scott, Rutty, Amelung and Tang 2016, *Atmosphere* 7(6):80, [doi:10.3390/atmos7060080](https://doi.org/10.3390/atmos7060080), full text read | A daily 0-100 index built from tourist surveys: 4 × thermal comfort (effective temperature from the daily high and mean humidity; 10 at 23-25 °C, 9 at 20-22 and 26, 8 at 27-28, 7 at 18-19 and 29-30) + 2 × aesthetics (cloud cover; 10 at 11-20%, 7 at 41-50%, 6 at 51-60%, 3 at 81-90%, never 0) + 3 × rain (10 at 0 mm, 9 under 3 mm, 8 at 3-6 mm, 0 above 12 mm) + wind (10 at 1-9 km/h, 9 at 10-19, 8 at 20-29, 6 at 30-39, 3 at 40-49, 0 at 50-70). Rain and wind can override a pleasant temperature. A beach variant (HCI:Beach) has warmer optima (not read). | Daily high, humidity, cloud, rain, wind | The best-founded holiday score. We use it to anchor thresholds (cloud, wind, rain), not as a number: a 0-100 index is not one sentence. |
| **Climate-Tourism Information Scheme (CTIS)**, Zaninović and Matzarakis 2009 | Frequencies, in ten-day steps, of days passing simple tests: thermal acceptance, heat stress, cold stress, sunny, cloudy, dry, wet, sultry, windy, fog, snow. **Not read first-hand**, so its thresholds are not used. | Daily or hourly station data with PET | Its *form* is exactly ours: plain day counts per test. |
| **PET and UTCI** | Physiological "feels like" temperatures from a full heat-balance model of the body, with heat-stress classes (UTCI strong heat stress from 32 °C, as widely published; class table not re-read). | Air temperature, humidity, wind, radiant temperature | We have Open-Meteo's apparent temperature (wind chill, humidity and sun, Steadman-style), a simpler cousin. We borrow UTCI's 32 °C line for heat-stress days and say so. |
| **Humidex, NWS heat index** | Heat and humidity combined into one temperature. | Air temperature, humidity or dew point | Covered by the apparent temperature we already use; a second "feels like" would confuse. |
| **ETCCDI climate indices** ([definitions](https://etccdi.pacificclimate.org/list_27_indices.shtml), read) | Standard day counts: tropical nights TR (daily low above 20 °C), summer days SU (high above 25 °C), frost days FD (low below 0 °C), icing days ID (high below 0 °C) and more. | Daily highs and lows | Kept: **Hot nights** is TR exactly. Frost and icing days are left out: winter cold already shows in the chart and in grey and snow days. |
| **Dew-point comfort** | Humid air feels sticky because sweat cannot evaporate. People used to temperate climates start to feel it above about 15-18 °C dew point; above 21 °C feels oppressive ([Wikipedia, Dew point](https://en.wikipedia.org/wiki/Dew_point#Relationship_to_human_comfort), read). WeatherSpark's "muggy" class is dew point-based too. | Dew point | Kept as **Muggy days**. |
| **Wind chill** | How cold wind makes cold air feel. | Air temperature, wind | Already inside the apparent temperature. |
| **Running and cycling weather** | Endurance performance is best in cool weather (marathon studies point to roughly 5-15 °C; not re-read for this page); no standard index exists. | Temperature, rain, wind | Kept as **Run or ride days**, thresholds marked as judgement. |

**Open.** The HCI:Beach and CTIS thresholds, and a test of each rule against a spread of climates.

## 3. The family

Each is a count of days, per month and per year, computed from hourly ERA5 at the city's grid point for the last five full years. Wording is the metric's one-sentence definition in `src/core/metrics.ts`.

| Score | One sentence | Rule | Rests on | Default weight |
|---|---|---|---|---|
| **Nice days** | Dry, mostly clear days that feel the way you like. | Under 1 mm of rain 8 am-8 pm; at most 50% of the sky clouded on average 8 am-8 pm; the average feels-like (or air, the person chooses) temperature 8 am-8 pm inside the person's range: nice days are yours to define, starting at 18-30 °C. | WeatherSpark tourism range; 1 mm is the usual wet-day line (WeatherSpark; ETCCDI counts wet days from 1 mm); HCI rates 41-50% cloud "7 of 10" and 51-60% "6", so 50% keeps days rated very good | 8 (the main weather line) |
| **Beach days** | Hot, sunny, dry days for a beach or an outdoor pool. | Under 1 mm 8 am-8 pm; at most 40% clouded; average feels-like 24-32 °C. | WeatherSpark beach/pool range; the stricter cloud cut is judgement | 0 |
| **Run or ride days** | Days with a dry, calm, cool-to-mild window for a run or a ride. | Two clock hours in a row between 6 am and 9 pm with feels-like 5-22 °C, wind under 30 km/h, and under 0.1 mm of rain in the hour after each. | Judgement, informed by endurance-heat findings; 30 km/h from HCI's wind scale | 0 |
| **Muggy days** | Days when the air is sticky with humidity. | The day's mean dew point at or above 18 °C. | Dew-point comfort (above) | 0 |
| **Grey days** | Overcast days. | Mean cloud 8 am-8 pm at least 80%. | HCI rates 81-90% cloud "3 of 10"; the cut is judgement | 0 |
| **Hot nights** | Nights too warm to sleep well without air conditioning. | The day's lowest air temperature above 20 °C. | ETCCDI TR | 0 |
| **Heat-stress days** | Days that feel 32 °C or hotter. | The highest feels-like 8 am-8 pm at or above 32 °C. | UTCI strong heat stress begins at 32 °C (apparent temperature is not UTCI: a proxy) | 0 |
| **Snow days** | Days with fresh snow. | At least 1 cm of snowfall in the day. | Judgement | 0 |
| **Windy days** | Days windy enough to be a nuisance all day. | Mean wind at 10 m 8 am-8 pm at least 30 km/h. | Beaufort 5 "fresh breeze" (29-38 km/h); HCI drops wind from 8 to 6 at 30 km/h | 0 |

Why these and not others: together they say something about every season (nice and grey days, snow), summer heat by day and night (heat-stress days, hot nights), humidity (muggy days) and wind, and two activities people move cities for (beach, running and cycling). Each reads as one sentence; no two count nearly the same thing (beach days are nice days' hot, sunny subset, which is why they are opt-in).

**Overlap to know about.** Nice days include a rain test, so they partly overlap "Dry days" (weight 3) and "Sunshine" (weight 4). Kept: dry days count rain only, sunshine is measured at stations, and nice days are the combination people actually feel.

## 4. Choices

| Question | Choice |
|---|---|
| Score form | A count of days passing plain tests, not a 0-10 composite: "14 nice days in May" reads in one sentence, and a person can change the range live. |
| Nice days, not comfortable months | One line, not two: two lines reading one range with different statistics (a month's average against a day's daytime average) would confuse, and nice days answer the same question better: they count days, and add rain and sky. The monthly view is nice days per month in the dossier strip and the chart's tooltips. A saved profile's "Comfortable months" weight counts for "Nice days"; agents sending `climate_comfort` are mapped to `nice_days`. |
| Monthly-average ranges | A saved range in the monthly-average form (default 12-24 °C) is replaced once by 18-30 °C feels-like, since keeping 12-24 °C on a daytime feels-like scale would silently mean something else. |
| Air or feels-like | The person chooses; default feels-like, as WeatherSpark and the HCI do. |
| Daytime | 8 am to 8 pm local, the span WeatherSpark scores less its last hour. Open-Meteo returns the whole period at one fixed UTC offset (the one valid on the day of the request), so in summer the window can run an hour early by the clock in places with daylight saving time. |
| Day temperature | The average over the daytime hours, not the peak: closer to WeatherSpark's hourly averaging, and a hot hour does not cancel a pleasant day. |
| Live range editing | Store per month, for the days passing the sky and rain tests, a histogram by daytime temperature in whole degrees (-5 to 40 °C, open ends): 552 numbers per temperature basis per city. Summing the bins inside the range gives that range's nice days with no refetch. A range is whole degrees and includes both ends. |
| Extremes | The lowest low and highest high of the five years; the 10th percentile of daily lows and 90th of daily highs (also the 90th of lows and 10th of highs). Five years is short: the page says "in 2021-2025", never "record". |
| Missing hours | A day missing any hour's temperature or any daytime value is left out; a month's count is the passing share of readable days times the month's length, so a gap neither adds nor removes nice days. |
| API budget | One request of 7 hourly variables; daily figures are aggregated here exactly as Open-Meteo aggregates its own ("a simple 24 hour aggregation from hourly values", its docs). Up to 10 variables over five years costs about 130 calls. |

## 5. Limits: what a person should not read as precise

- **Cloud cover** is ERA5's total cloud, which counts thin high cloud; whether a day is "mostly clear" is the weakest test here. Read nice, beach and grey days as comparisons between cities, not exact days.
- **Light rain** in reanalyses falls too often as drizzle; the 1 mm daytime test absorbs most of it, the 0.1 mm-per-hour test for runs less so.
- **Wind at 10 m** in a 25 km grid cell is open-country wind; streets are calmer, coasts and hills windier.
- **Coastal and mountain cities** (San Francisco, Lisbon, Wellington, Zurich) sit in grid cells that mix sea or hills with the city; temperatures can be a degree or two off.
- **Five years** (2021-2025) is weather, not climate: one hot summer moves a count by a few days.

## 6. Where it lives

- Rules and day reduction: `src/core/weather-days.ts` (pure, tested in `test/weather-days.test.ts` on synthetic hours).
- Fetcher: `src/fetch/open-meteo.ts` (version 3); snapshot: `pipeline/sources/open-meteo.ts`.
- Metrics and their sentences: `src/core/metrics.ts`; lines: `src/core/criteria.ts` (`nice_days`, `beach`, `run_ride`, `muggy`, `grey`, `hot_nights`, `heat`, `snow`, `wind`).
- Chart (app and published pages): `src/ui/climate-chart.ts`.
