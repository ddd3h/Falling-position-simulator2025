/*
 * CUSF Landing Prediction Version 3
 * Mark Jessop 2019
 * vk5qi@rfhead.net
 *
 * http://github.com/jonsowman/cusf-standalone-predictor
 *
 */


function initLaunchCard(){
    // Initialise the time/date on the launch card.

    // var today = new Date();

    // $('#year').val(today.getFullYear());
    // $('#day').val(today.getDate());
    // var month = today.getMonth()+1;
    // $("#month").val(month).change();
    // $('#hour').val(today.getHours());
    // $('#min').val(today.getMinutes());
    // $('#sec').val(today.getSeconds());

    var today = moment.utc();  // utc

    $('#year').val(today.year());
    $('#day').val(today.date());
    var month = today.month()+1;
    $("#month").val(month).change();
    $('#hour').val(today.hours());
    $('#min').val(today.minutes());
}


function runPrediction(){
    // Read the user-supplied parameters and request a prediction.
    var run_settings = {};
    var extra_settings = {};
    run_settings.profile = $('#flight_profile').val();
    run_settings.pred_type = $('#prediction_type').val();
    
    // Grab date values
    var year = $('#year').val();
    var month = $('#month').val();
    var day = $('#day').val();
    var hour = $('#hour').val();
    var minute = $('#min').val();

    // Months are zero-indexed in Javascript. Wat.
    var launch_time_plus_8_hours = moment.utc([year, month-1, day, hour, minute, 0, 0]);
    var launch_time = launch_time_plus_8_hours.subtract(8, 'hours');
    run_settings.launch_datetime = launch_time.format();
    extra_settings.launch_moment = launch_time;

    // Sanity check the launch date to see if it's not too far into the past or future.
    if(launch_time < (moment.utc().subtract(12, 'hours'))){
        throwError("Launch time too old (outside of model time range).");
        return;
    }
    if(launch_time > (moment.utc().add(7, 'days'))){
        throwError("Launch time too far into the future (outside of model time range).");
        return;
    }

    // Grab other launch settings.
    run_settings.launch_latitude = parseFloat($('#lat').val());
    run_settings.launch_longitude = parseFloat($('#lon').val());
    // Handle negative longitudes - Tawhiri wants longitudes between 0-360
    if (run_settings.launch_longitude < 0.0){
        run_settings.launch_longitude += 360.0
    }
    run_settings.launch_altitude = parseFloat($('#initial_alt').val());
    run_settings.ascent_rate = parseFloat($('#ascent').val());

    if (run_settings.profile == "standard_profile"){
        run_settings.burst_altitude = parseFloat($('#burst').val());
        run_settings.descent_rate = parseFloat($('#drag').val());
    } else {
        run_settings.float_altitude = parseFloat($('#burst').val());
        run_settings.stop_datetime = launch_time.add(1, 'days').format();
    }


    // Update the URL with the supplied parameters.
    url = new URL(window.location.href);
    // Should probably clear all these parameters before setting them again?
    if (time_was_now){
        url.searchParams.set('launch_datetime','now');
    }else {
        url.searchParams.set('launch_datetime', run_settings.launch_datetime);
    }
    url.searchParams.set('launch_latitude', run_settings.launch_latitude);
    url.searchParams.set('launch_longitude', run_settings.launch_longitude);
    url.searchParams.set('launch_altitude', run_settings.launch_altitude);
    url.searchParams.set('ascent_rate', run_settings.ascent_rate);
    url.searchParams.set('profile', run_settings.profile);
    url.searchParams.set('prediction_type', run_settings.pred_type);
    if (run_settings.profile == "standard_profile"){
        url.searchParams.set('burst_altitude', run_settings.burst_altitude);
        url.searchParams.set('descent_rate', run_settings.descent_rate);
    } else {
        url.searchParams.set('float_altitude', run_settings.float_altitude);
    }

    // Update browser URL.
    history.replaceState(
        {},
        'WASA/ Falling-Position-Simulator',
        url.href
    );


    // Run the request
    tawhiriRequest(run_settings, extra_settings);

}

// Tawhiri API URL. Refer to API docs here: https://tawhiri.readthedocs.io/en/latest/api.html
// Habitat Tawhiri Instance
//var tawhiri_api = "https://predict.cusf.co.uk/api/v1/";
// Sondehub Tawhiri Instance
var tawhiri_api = "https://api.v2.sondehub.org/tawhiri";
// Approximately how many hours into the future the model covers.
var MAX_PRED_HOURS = 169;

function tawhiriRequest(settings, extra_settings){
    // Request a prediction via the Tawhiri API.
    // Settings must be as per the API docs above.

    if(settings.pred_type=='single'){
        hourly_mode = false;
        $.get( tawhiri_api, settings )
            .done(function( data ) {
                processTawhiriResults(data, settings);
            })
            .fail(function(data) {
                var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                if(data.hasOwnProperty("responseJSON"))
                {
                    prediction_error += data.responseJSON.error.description;
                }

                throwError(prediction_error);
            })
            .always(function(data) {
                //throwError("test.");
                //console.log(data);
            });
    } else {
        // For Multiple predictions, we do things a bit differently.
        hourly_mode = true;
        // First up clear off anything on the map.
        clearMapItems();
        clearMarkers();

        // Also clean up any hourly prediction data.
        hourly_predictions = {};

        var current_hour = 0;
        var time_step = 24;

        if(settings.pred_type=='daily'){
            time_step = 24;
        } else if (settings.pred_type=='1_hour'){
            time_step = 1;
        } else if (settings.pred_type=='3_hour'){
            time_step = 3;
        } else if (settings.pred_type=='6_hour'){
            time_step = 6;
        } else if (settings.pred_type=='12_hour'){
            time_step = 12;
        } else if (settings.pred_type=='Gaussian_distribution'){
            plotGaussianDistribution(settings, extra_settings);
            return;
        } else if (settings.pred_type=='Weibull_distribution'){
            plotWeibullDistribution(settings, extra_settings);
            return;
        } else {
            throwError("Invalid time step.");
            return;
        }

        if(settings.profile != "standard_profile"){
            throwError("Hourly/Daily predictions are only available for the standard flight profile.");
            return;
        }

        // Loop to advance time until end of prediction window
        while(current_hour < MAX_PRED_HOURS){
            // Update launch time
            var current_moment = moment(extra_settings.launch_moment).add(current_hour, 'hours');

            // Setup entries in the hourly prediction data store.
            hourly_predictions[current_hour] = {};
            hourly_predictions[current_hour]['layers'] = {};
            hourly_predictions[current_hour]['settings'] = {...settings};
            hourly_predictions[current_hour]['settings']['launch_datetime'] = current_moment.format();
            
            // Copy our current settings for passing into the requst.
            var current_settings = {...hourly_predictions[current_hour]['settings']};

            $.get( {url:tawhiri_api, 
                data: current_settings, 
                current_hour: current_hour} )
                .done(function( data ) {
                    processHourlyTawhiriResults(data, current_settings, this.current_hour);
                })
                .fail(function(data) {
                    var prediction_error = "Prediction failed. Tawhiri may be under heavy load, please try again. ";
                    if(data.hasOwnProperty("responseJSON"))
                    {
                        prediction_error += data.responseJSON.error.description;
                    }

                    // Silently handle failed predictions, which are most likely
                    // because the prediction time was too far into the future.
                    delete hourly_predictions[this.current_hour]
                    //throwError(prediction_error);
                })
                .always(function(data) {
                    //throwError("test.");
                    //console.log(data);
                });

            current_hour += time_step;

        }

            // Generate prediction number and information to pass onwards to plotting
            // Run async get call, pass in prediction details.

            // Need new processing functions to plot just the landing spot, and then somehow a line between them?
            

    }
}

function processTawhiriResults(data, settings){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);

        plotStandardPrediction(prediction_results);

        writePredictionInfo(settings, data.metadata, data.request);
        
    }

    //console.log(data);

}

function parsePrediction(prediction){
    // Convert a prediction in the Tawhiri API format to a Polyline.

    var flight_path = [];
    var launch = {};
    var burst = {};
    var landing = {};

    var ascent =  prediction[0].trajectory;
    var descent =  prediction[1].trajectory;

    // Add the ascent track to the flight path array.
    ascent.forEach(function (item, index){
        var _lat = item.latitude;
        // Correct for API giving us longitudes outside [-180, 180]
        var _lon = item.longitude;
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Add the Descent or Float track to the flight path array.
    descent.forEach(function (item, index){
        var _lat = item.latitude;
        var _lon = item.longitude;
        // Correct for API giving us longitudes outside [-180, 180]
        if (_lon > 180.0){
            _lon = _lon - 360.0;
        }

        flight_path.push([_lat, _lon, item.altitude]);
    });

    // Populate the launch, burst and landing points
    var launch_obj = ascent[0];
    var _lon = launch_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    launch.latlng = L.latLng([launch_obj.latitude, _lon, launch_obj.altitude]);
    launch.datetime = moment.utc(launch_obj.datetime);

    var burst_obj = descent[0];
    var _lon = burst_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    burst.latlng = L.latLng([burst_obj.latitude, _lon, burst_obj.altitude]);
    burst.datetime = moment.utc(burst_obj.datetime);

    var landing_obj = descent[descent.length - 1];
    var _lon = landing_obj.longitude;
    if (_lon > 180.0){
        _lon = _lon - 360.0;
    }
    landing.latlng = L.latLng([landing_obj.latitude, _lon, landing_obj.altitude]);
    landing.datetime = moment.utc(landing_obj.datetime);

    var profile = null;
    if(prediction[1].stage == 'descent'){
        profile = 'standard_profile';
    } else {
        profile = 'float_profile';
    }

    var flight_time = landing.datetime.diff(launch.datetime, 'seconds');

    return {'flight_path': flight_path, 'launch': launch, 'burst': burst, 'landing':landing, 'profile': profile, 'flight_time': flight_time};
}

function plotStandardPrediction(prediction){

    appendDebug("Flight data parsed, creating map plot...");
    clearMapItems();
    clearMarkers();

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;

    // Calculate range and time of flight
    var range = distHaversine(launch.latlng, landing.latlng, 1);
    var flighttime = "";
    var f_hours = Math.floor(prediction.flight_time / 3600);
    var f_minutes = Math.floor(((prediction.flight_time % 86400) % 3600) / 60);
    if ( f_minutes < 10 ) f_minutes = "0"+f_minutes;
    flighttime = f_hours + "hr" + f_minutes;
    $("#cursor_pred_range").html(range);
    $("#cursor_pred_time").html(flighttime);
    cursorPredShow();

    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var land_icon = L.icon({
        iconUrl: land_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });

    var burst_icon = L.icon({
        iconUrl: burst_img,
        iconSize: [16,16],
        iconAnchor: [8,8]
    });


    var launch_marker = L.marker(
        launch.latlng,
        {
            title: 'Balloon launch ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+') at ' 
            + launch.datetime.format("HH:mm") + " UTC",
            icon: launch_icon
        }
    ).addTo(map);
    
    var land_marker = L.marker(
        landing.latlng,
        {
            title: 'Predicted Landing ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+') at ' 
            + landing.datetime.format("HH:mm") + " UTC",
            icon: land_icon
        }
    ).addTo(map);

    var pop_marker = L.marker(
        burst.latlng,
        {
            title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
            ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
            + burst.datetime.format("HH:mm") + " UTC",
            icon: burst_icon
        }
    ).addTo(map);

    var path_polyline = L.polyline(
        prediction.flight_path,
        {
            weight: 3,
            color: '#000000'
        }
    ).addTo(map);



    // Add the launch/land markers to map
    // We might need access to these later, so push them associatively
    map_items['launch_marker'] = launch_marker;
    map_items['land_marker'] = land_marker;
    map_items['pop_marker'] = pop_marker;
    map_items['path_polyline'] = path_polyline;

    // Pan to the new position
    map.setView(launch.latlng,map.getZoom())

    return true;
}


// Populate and enable the download CSV, KML and Pan To links, and write the 
// time the prediction was run and the model used to the Scenario Info window
function writePredictionInfo(settings, metadata, request) {
    // populate the download links

    // Create the API URLs based on the current prediction settings
    _base_url = tawhiri_api + "?" + $.param(settings) 
    _csv_url = _base_url + "&format=csv";
    _kml_url = _base_url + "&format=kml";


    $("#dlcsv").attr("href", _csv_url);
    $("#dlkml").attr("href", _kml_url);
    $("#panto").click(function() {
            map.panTo(map_items['launch_marker'].getLatLng());
            //map.setZoom(7);
    });

    var run_time = moment.utc(metadata.complete_datetime).format();
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}


function processHourlyTawhiriResults(data, settings, current_hour){
    // Process results from a Tawhiri run.

    if(data.hasOwnProperty('error')){
        // The prediction API has returned an error.
        throwError("Predictor returned error: "+ data.error.description)
    } else {

        var prediction_results = parsePrediction(data.prediction);

        // Save prediction data into our hourly predictor data store.
        hourly_predictions[current_hour]['results'] = prediction_results;

        // Now plot...
        plotMultiplePrediction(prediction_results, current_hour);

        writeHourlyPredictionInfo(settings, data.metadata, data.request);
        
    }

    //console.log(data);

}

function plotMultiplePrediction(prediction, current_hour){

    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;


    // Make some nice icons
    var launch_icon = L.icon({
        iconUrl: launch_img,
        iconSize: [10,10],
        iconAnchor: [5,5]
    });


    if(!map_items.hasOwnProperty("launch_marker")){
        var launch_marker = L.marker(
            launch.latlng,
            {
                title: 'Balloon launch ('+launch.latlng.lat.toFixed(4)+', '+launch.latlng.lng.toFixed(4)+')',
                icon: launch_icon
            }
        ).addTo(map);

        map_items['launch_marker'] = launch_marker;
    }

    var iconColour = ConvertRGBtoHex(evaluate_cmap((current_hour/MAX_PRED_HOURS), 'turbo'));
    var land_marker= new L.CircleMarker(landing.latlng, {
        radius: 5,
        fillOpacity: 1.0,
        zIndexOffset: 1000,
        fillColor: iconColour,
        stroke: true,
        weight: 1,
        color: "#000000",
        title: '<b>Launch Time: </b>' + launch.datetime.format() + '<br/>' + 'Predicted Landing ('+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+')',
        current_hour: current_hour // Added in so we can extract this when we get a click event.
    }).addTo(map);

    var _base_url = tawhiri_api + "?" + $.param(hourly_predictions[current_hour]['settings']) 
    var _csv_url = _base_url + "&format=csv";
    var _kml_url = _base_url + "&format=kml";

    var predict_description =  '<b>Launch Time: </b>' + launch.datetime.format() + '<br/>' + 
    '<b>Predicted Landing:</b> '+landing.latlng.lat.toFixed(4)+', '+landing.latlng.lng.toFixed(4)+ '</br>' +
    '<b>Landing Time: </b>' + landing.datetime.format() + '<br/>' +
    '<b>Download: </b> <a href="'+_kml_url+'" target="_blank">KML</a>  <a href="'+_csv_url+'" target="_blank">CSV</a></br>';

    var landing_popup = new L.popup(
        { autoClose: false, 
            closeOnClick: false, 
        }).setContent(predict_description);
    land_marker.bindPopup(landing_popup);
    land_marker.on('click', showHideHourlyPrediction);

    hourly_predictions[current_hour]['layers']['landing_marker'] = land_marker;
    hourly_predictions[current_hour]['landing_latlng'] = landing.latlng;

    // Generate polyline latlons.
    landing_track = [];
    landing_track_complete = true;
    for (i in hourly_predictions){
        if(hourly_predictions[i]['landing_latlng']){
            landing_track.push(hourly_predictions[i]['landing_latlng']);
        }else{
            landing_track_complete = false;
        }
    }
    // If we dont have any undefined elements, plot.
    if(landing_track_complete){
        if(hourly_polyline){
            hourly_polyline.setLatLngs(landing_track);
        } else {
            hourly_polyline = L.polyline(
                landing_track,
                {
                    weight: 2,
                    zIndexOffset: 100,
                    color: '#000000'
                }
            ).addTo(map);
        }

        for (i in hourly_predictions){
            hourly_predictions[i]['layers']['landing_marker'].remove();
            hourly_predictions[i]['layers']['landing_marker'].addTo(map);
        }

        map.fitBounds(hourly_polyline.getBounds());
        map.setZoom(8);

        $("#cursor_pred_lastrun").show();

    }

    return true;
}

function showHideHourlyPrediction(e){

    // Extract the current hour from the marker options.
    var current_hour = e.target.options.current_hour;
    var current_pred = hourly_predictions[current_hour]['results'];
    var landing = current_pred.landing;
    var launch = current_pred.launch;
    var burst = current_pred.burst;
    

    if(hourly_predictions[current_hour]['layers'].hasOwnProperty('flight_path')){
        // Flight path layer already exists, remove it and the burst icon.
        hourly_predictions[current_hour]['layers']['flight_path'].remove()
        hourly_predictions[current_hour]['layers']['pop_marker'].remove()
        delete hourly_predictions[current_hour]['layers'].flight_path;
        delete hourly_predictions[current_hour]['layers'].pop_marker;

    } else {
        // We need to make new icons.

        var burst_icon = L.icon({
            iconUrl: burst_img,
            iconSize: [16,16],
            iconAnchor: [8,8]
        });

        var pop_marker = L.marker(
            burst.latlng,
            {
                title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
                ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
                + burst.datetime.format("HH:mm") + " UTC",
                icon: burst_icon,
                current_hour: current_hour
            }
        ).addTo(map);
        
        hourly_predictions[current_hour]['layers']['pop_marker'] = pop_marker;

        var path_polyline = L.polyline(
            current_pred.flight_path,
            {
                weight: 3,
                color: '#000000',
                current_hour: current_hour
            }
        ).addTo(map);
        path_polyline.on('click', showHideHourlyPrediction);

        hourly_predictions[current_hour]['layers']['flight_path'] = path_polyline;
    }

}

function writeHourlyPredictionInfo(settings, metadata, request) {
    // populate the download links

    // // Create the API URLs based on the current prediction settings
    // _base_url = tawhiri_api + "?" + $.param(settings) 
    // _csv_url = _base_url + "&format=csv";
    // _kml_url = _base_url + "&format=kml";


    // $("#dlcsv").attr("href", _csv_url);
    // $("#dlkml").attr("href", _kml_url);
    // $("#panto").click(function() {
    //         map.panTo(map_items['launch_marker'].getLatLng());
    //         //map.setZoom(7);
    // });

    var run_time = moment.utc(metadata.complete_datetime).format();
    var dataset = moment.utc(request.dataset).format("YYYYMMDD-HH");


    $("#run_time").html(run_time);
    $("#dataset").html(dataset);
}

var markers = [];

function clearMarkers() {
    markers.forEach(function(marker) {
        map.removeLayer(marker);
        if (marker.flight_path) {
            map.removeLayer(marker.flight_path);
        }
        if (marker.burst_marker) {
            map.removeLayer(marker.burst_marker);
        }
    });
    markers = []; 
}

function plotGaussianDistribution(settings, extra_settings) {
    var ascent_rate = parseFloat($('#ascent').val());
    var burst_altitude = parseFloat($('#burst').val());
    var descent_rate = parseFloat($('#drag').val());

    clearMarkers();

    // Create Gaussian distributed values for burst altitude and descent rate
    var ascent_rates = [];
    var burst_altitudes = [];
    var descent_rates = [];

    // Store all landing points for KML/CSV export
    var all_landing_points = [];
    var all_prediction_results = [];
    var completedRequests = 0;
    var totalRequests = 101; // 100 samples + 1 central point

    var ascent_std_dev = 0.5;  // ±0.5 m/s for ascent rate
    var burst_std_dev = burst_altitude * 0.05; // ±5% of burst altitude
    var descent_std_dev = 0.5;  // ±0.5 m/s for descent rate

    // Generate Gaussian distribution for burst altitude and descent rate
    for (var i = 0; i < 100; i++) {
        var ascent_sample = gaussianRandom(ascent_rate, ascent_std_dev);
        var burst_sample = gaussianRandom(burst_altitude, burst_std_dev);
        var descent_sample = gaussianRandom(descent_rate, descent_std_dev);
        ascent_rates.push(ascent_sample);
        burst_altitudes.push(burst_sample);
        descent_rates.push(descent_sample);
    }

    // Central landing point (mean values)
    var centralSettings = { ...settings };
    centralSettings.ascent_rate = ascent_rate;
    centralSettings.burst_altitude = burst_altitude;
    centralSettings.descent_rate = descent_rate;

    var central_point = null;
    $.get(tawhiri_api, centralSettings)
        .done(function (data) {
            central_point = parsePrediction(data.prediction).landing.latlng;

            var central_prediction_results = parsePrediction(data.prediction);
            all_prediction_results.push({
                result: central_prediction_results,
                color: 'red',
                isCentral: true,
                ascent: ascent_rate,
                burst: burst_altitude,
                descent: descent_rate
            });
            all_landing_points.push({
                latlng: central_point,
                color: 'red',
                isCentral: true,
                ascent: ascent_rate,
                burst: burst_altitude,
                descent: descent_rate
            });
            
            plotMultiplePredictionWithColor(central_prediction_results, -1, 'red'); // -1は中央点を示す
            completedRequests++;

            // Plot the distributions on the map
            var landing_points = [];
            for (let i = 0; i < burst_altitudes.length; i++) { // let を使うことでスコープを固定
                var settings_copy = { ...settings };
                settings_copy.ascent_rate = ascent_rates[i];
                settings_copy.burst_altitude = burst_altitudes[i];
                settings_copy.descent_rate = descent_rates[i];
            
                // Run the prediction for each sample
                $.get(tawhiri_api, settings_copy)
                    .done(function (data) {
                        var prediction_results = parsePrediction(data.prediction);
                        var landing_point = prediction_results.landing.latlng;
                        landing_points.push(landing_point);
            
                        var ascent_diff = Math.abs(ascent_rates[i] - ascent_rate)/ ascent_std_dev;
                        var burst_diff = Math.abs(burst_altitudes[i] - burst_altitude) / burst_std_dev;
                        var descent_diff = Math.abs(descent_rates[i] - descent_rate) / descent_std_dev;
                        // Map distance to a color
                        var color = diffToColor(ascent_diff, burst_diff, descent_diff);
                        
                        // Store for export
                        all_prediction_results.push({
                            result: prediction_results,
                            color: color,
                            isCentral: false,
                            ascent: ascent_rates[i],
                            burst: burst_altitudes[i],
                            descent: descent_rates[i]
                        });
                        all_landing_points.push({
                            latlng: landing_point,
                            color: color,
                            isCentral: false,
                            ascent: ascent_rates[i],
                            burst: burst_altitudes[i],
                            descent: descent_rates[i]
                        });
                        
                        // Plot each prediction result with color
                        plotMultiplePredictionWithColor(prediction_results, i, color, ascent_diff, burst_diff, descent_diff);
                        
                        completedRequests++;
                        
                        // When all predictions are complete, enable download buttons
                        if (completedRequests >= totalRequests) {
                            enableGaussianDownloads(all_landing_points, all_prediction_results);
                        }
                    })
                    .fail(function (data) {
                        console.error("Prediction failed for Gaussian sample");
                        completedRequests++;
                        
                        // Even if some fail, enable downloads when all requests are processed
                        if (completedRequests >= totalRequests) {
                            enableGaussianDownloads(all_landing_points, all_prediction_results);
                        }
                    });
            }
        })
        .fail(function (data) {
            console.error("Central point prediction failed");
            completedRequests++;
        });
}

// Add new functions for KML and CSV generation for Gaussian distribution
function enableGaussianDownloads(landingPoints, predictionResults) {
    // First clean up any existing download buttons
    $('#gaussian-download-container').remove();
    
    // Add download buttons in same style and location as other prediction types
    var container = $('<div id="gaussian-download-container" class="panel-body"></div>');
    
    var kmlBtn = $('<a id="gaussian-download-kml" class="btn btn-default">Download KML</a>');
    var csvBtn = $('<a id="gaussian-download-csv" class="btn btn-default">Download CSV</a>');
    
    container.append(kmlBtn).append(' ').append(csvBtn);
    
    // Insert the container at the same location as other downloads
    $('#downloads').append(container);
    
    // Add click handlers
    $('#gaussian-download-kml').off('click').on('click', function(e) {
        e.preventDefault();
        downloadGaussianKML(landingPoints, predictionResults);
    });
    
    $('#gaussian-download-csv').off('click').on('click', function(e) {
        e.preventDefault();
        downloadGaussianCSV(landingPoints, predictionResults);
    });
    
    // Show the download section if it was hidden
    $('#downloads').show();
}

function downloadGaussianKML(landingPoints, predictionResults) {
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    kml += '<Document>\n';
    kml += '<name>WASA Gaussian Distribution Prediction</name>\n';
    
    // Add style for central point
    kml += '<Style id="centralPoint">\n';
    kml += '  <IconStyle>\n';
    kml += '    <color>ff0000ff</color>\n';
    kml += '    <scale>1.2</scale>\n';
    kml += '  </IconStyle>\n';
    kml += '</Style>\n';
    
    // Add style for other points
    kml += '<Style id="samplePoint">\n';
    kml += '  <IconStyle>\n';
    kml += '    <scale>0.8</scale>\n';
    kml += '  </IconStyle>\n';
    kml += '</Style>\n';
    
    // Add points
    landingPoints.forEach(function(point, index) {
        var styleUrl = point.isCentral ? "#centralPoint" : "#samplePoint";
        var name = point.isCentral ? "Central Landing Point" : "Sample Landing Point " + index;
        var description = "Ascent Rate: " + point.ascent.toFixed(2) + " m/s<br/>" +
                         "Burst Altitude: " + point.burst.toFixed(2) + " m<br/>" +
                         "Descent Rate: " + point.descent.toFixed(2) + " m/s";
        
        kml += '<Placemark>\n';
        kml += '  <name>' + name + '</name>\n';
        kml += '  <description><![CDATA[' + description + ']]></description>\n';
        kml += '  <styleUrl>' + styleUrl + '</styleUrl>\n';
        kml += '  <Point>\n';
        kml += '    <coordinates>' + point.latlng.lng + ',' + point.latlng.lat + ',0</coordinates>\n';
        kml += '  </Point>\n';
        kml += '</Placemark>\n';
    });
    
    kml += '</Document>\n';
    kml += '</kml>';
    
    // Create download link
    var blob = new Blob([kml], {type: 'application/vnd.google-earth.kml+xml'});
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'gaussian_prediction_' + new Date().toISOString().split('T')[0] + '.kml';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}

function downloadGaussianCSV(landingPoints, predictionResults) {
    var csv = 'Type,Latitude,Longitude,Ascent Rate (m/s),Burst Altitude (m),Descent Rate (m/s),Color\n';
    
    landingPoints.forEach(function(point) {
        var type = point.isCentral ? "Central" : "Sample";
        csv += type + ',' +
               point.latlng.lat + ',' +
               point.latlng.lng + ',' +
               point.ascent.toFixed(2) + ',' +
               point.burst.toFixed(2) + ',' +
               point.descent.toFixed(2) + ',' +
               point.color + '\n';
    });
    
    // Create download link
    var blob = new Blob([csv], {type: 'text/csv'});
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'gaussian_prediction_' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}

function gaussianRandom(mean, stdDev) {
    var u = 0, v = 0;
    while(u === 0) u = Math.random(); // Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdDev + mean;
}

function diffToColor(ascent_diff, burst_diff, descent_diff) {

    var red = 255 - Math.round(255 * ascent_diff /3);
    var blue = 255 - Math.round(255 * burst_diff /3); 
    var green = 255 - Math.round(255 * descent_diff /3); 

    return 'rgb(' + red + ',' + green + ',' + blue + ')';
}

function plotMultiplePredictionWithColor(prediction_results, i, color, ascent_diff = 0, burst_diff = 0, descent_diff = 0, isWeibull = false) {
    var launch = prediction_results.launch;
    var landing = prediction_results.landing;
    var burst = prediction_results.burst;
    var latlng = prediction_results.landing.latlng;
    
    var landing_time = prediction_results.landing.datetime.add(8, 'hours').format("YYYY-MM-DD HH:mm:ss");
    var flight_time_seconds = prediction_results.flight_time;
    var flight_time = moment.duration(flight_time_seconds, 'seconds');  // Convert flight time to human-readable format

    // Formatting flight time as hours, minutes, seconds
    var flight_time_str = flight_time.hours() + '時間 ' + flight_time.minutes() + '分 ' + flight_time.seconds() + '秒';

    changeRadius = (i === -1 ? 8 : 5 );
    var marker = L.circleMarker(latlng, {
        radius: changeRadius,
        fillColor: color,
        color: color,
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8,
        index: i
    }).addTo(map);

    markers.push(marker);

    var latDMS = toDMS(latlng.lat);  
    var lngDMS = toDMS(latlng.lng); 
    
    // プレーンテキストバージョンの予測内容を作成 (クリップボード用)
    var predict_text;
    if (isWeibull) {
        // Format for Weibull distribution
        predict_text = (i === -1 ? 'ワイブル中心点' : 'ワイブルサンプル' + (i + 1)) + ':\n' +
            '着地予測(10進法): ' + latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '\n' +
            '着地予測(60進法): ' + latDMS + ', ' + lngDMS + '\n' +
            'バースト高度: ' + burst.latlng.alt.toFixed(0) + ' m\n' +
            'バースト高度差: ' + (i === -1 ? '0.0' : burst_diff.toFixed(1)) + '%\n' +
            '着地予定時刻: ' + landing_time + '\n' + 
            '飛行時間: ' + flight_time_str;
    } else {
        // Original format for Gaussian distribution
        predict_text = (i === -1 ? '中心点' : 'サンプル' + (i + 1)) + ':\n' +
            '着地予測(10進法): ' + latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '\n' +
            '着地予測(60進法): ' + latDMS + ', ' + lngDMS + '\n' +
            '上昇速度差: σ=' + ascent_diff.toFixed(2) + '\n' +
            'バースト高度差: σ=' + burst_diff.toFixed(2) + '\n' +
            '降下速度差: σ=' + descent_diff.toFixed(2) + '\n' +
            '着地予定時刻: ' + landing_time + '\n' + 
            '飛行時間: ' + flight_time_str;
    }
    
    // 一意のIDをボタンに割り当て
    var buttonId = 'copy-btn-' + (i === -1 ? 'central' : i);
    var kmlButtonId = 'kml-btn-' + (i === -1 ? 'central' : i);
    var csvButtonId = 'csv-btn-' + (i === -1 ? 'central' : i);
    
    // コピーボタン付きの予測内容を作成
    var predict_description;
    if (isWeibull) {
        // Enhanced display for Weibull distribution with better highlighting of burst altitude difference
        var burst_alt_display = '';
        if (i !== -1) {
            var percentClass = burst_diff >= 0 ? 'positive-diff' : 'negative-diff';
            var sign = burst_diff >= 0 ? '+' : '';
            burst_alt_display = '<span style="background-color: #FFFF00; font-weight: bold;">' + sign + burst_diff.toFixed(1) + '%</span>';
        } else {
            burst_alt_display = '0.0%';
        }
        
        predict_description = 
            '<div style="position: relative;">' +
            '<button id="' + buttonId + '" ' +
            'style="position: absolute; top: 0; right: 0; background: none; border: none; cursor: pointer;" ' +
            'title="クリップボードにコピー">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">' +
            '<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>' +
            '<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>' +
            '</svg>' +
            '</button>' +
            '<div>' +
            '<b style="color: #0000CC;">' + (i === -1 ? 'ワイブル中心点' : 'ワイブルサンプル' + (i + 1)) + ':</b><br/>' +
            '<b>着地予測(10進法):</b> ' + latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '<br/>' +
            '<b>着地予測(60進法):</b> ' + latDMS + ', ' + lngDMS + '<br/>' +
            '<b>バースト高度:</b> ' + burst.latlng.alt.toFixed(0) + ' m<br/>' +
            '<div style="margin: 5px 0; padding: 5px; border: 1px solid #ccc; background-color: #f8f8f8;">' +
            '<b>バースト高度差:</b> ' + burst_alt_display + '<br/>' +
            '</div>' +
            '<b>着地予定時刻:</b> ' + landing_time + '<br/>' + 
            '<b>飛行時間:</b> ' + flight_time_str + '<br/>' +
            '<div style="margin-top: 10px;">' +
            '<button id="' + kmlButtonId + '" style="margin-right: 5px;" class="control_button">KML</button>' +
            '<button id="' + csvButtonId + '" class="control_button">CSV</button>' +
            '</div>' +
            '</div>' +
            '</div>';
    } else {
        // Original display for Gaussian distribution
        predict_description = 
            '<div style="position: relative;">' +
            '<button id="' + buttonId + '" ' +
            'style="position: absolute; top: 0; right: 0; background: none; border: none; cursor: pointer;" ' +
            'title="クリップボードにコピー">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">' +
            '<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>' +
            '<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>' +
            '</svg>' +
            '</button>' +
            '<div>' +
            '<b>' + (i === -1 ? '中心点' : 'サンプル' + (i + 1)) + ':</b><br/>' +
            '<b>着地予測(10進法):</b> ' + latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4) + '<br/>' +
            '<b>着地予測(60進法):</b> ' + latDMS + ', ' + lngDMS + '<br/>' +
            '<b>上昇速度差:</b> ' + 'σ=' + ascent_diff.toFixed(2) + '<br/>' +
            '<b>バースト高度差:</b> ' + 'σ=' + burst_diff.toFixed(2) + '<br/>' +
            '<b>降下速度差:</b> ' + 'σ=' + descent_diff.toFixed(2) + '<br/>' +
            '<b>着地予定時刻:</b> ' + landing_time + '<br/>' + 
            '<b>飛行時間:</b> ' + flight_time_str + '<br/>' +
            '<div style="margin-top: 10px;">' +
            '<button id="' + kmlButtonId + '" style="margin-right: 5px;" class="control_button">KML</button>' +
            '<button id="' + csvButtonId + '" class="control_button">CSV</button>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    // ポップアップを作成
    var landing_popup = new L.popup({
        autoClose: false,
        closeOnClick: false,
    }).setContent(predict_description);
    
    marker.bindPopup(landing_popup);
    
    // コピーするテキストをマーカーに保存
    marker.copyText = predict_text;
    marker.prediction = prediction_results;
    marker.isCenter = (i === -1);
    marker.markerColor = color;
    marker.ascent_diff = ascent_diff;
    marker.burst_diff = burst_diff;
    marker.descent_diff = descent_diff;
    marker.markerId = i;
    marker.isWeibull = isWeibull;
    
    // ポップアップが開かれたときにボタンにイベントハンドラを追加
    marker.on('popupopen', function(e) {
        // ボタン要素を取得しクリックイベントを追加
        setTimeout(function() {
            // コピーボタンのイベントハンドラ
            var button = document.getElementById(buttonId);
            if (button) {
                button.onclick = function() {
                    copyToClipboard(marker.copyText);
                };
            }
            
            // KMLダウンロードボタンのイベントハンドラ
            var kmlButton = document.getElementById(kmlButtonId);
            if (kmlButton) {
                kmlButton.onclick = function() {
                    downloadSingleMarkerKML(marker);
                };
            }
            
            // CSVダウンロードボタンのイベントハンドラ
            var csvButton = document.getElementById(csvButtonId);
            if (csvButton) {
                csvButton.onclick = function() {
                    downloadSingleMarkerCSV(marker);
                };
            }
        }, 100); // 少し遅延させてDOMが完全に構築されるのを待つ
    });
    
    // 中心点の場合は自動的にポップアップを開く
    if (i === -1) {
        marker.openPopup();
        var path_polyline = L.polyline(prediction_results.flight_path, {
            weight: 3,
            color: '#000000'
        }).addTo(map);
        marker.flight_path = path_polyline;
    }

    // バーストアイコンを作成
    var burst_icon = L.icon({
        iconUrl: burst_img,
        iconSize: [16,16],
        iconAnchor: [8,8]
    });
    
    // バーストマーカーを追加 (すべての予測点に対して)
    var burst_marker = L.marker(
        burst.latlng,
        {
            title: 'Balloon burst ('+burst.latlng.lat.toFixed(4)+', '+burst.latlng.lng.toFixed(4)+ 
            ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
            + burst.datetime.format("HH:mm") + " UTC",
            icon: burst_icon
        }
    ).addTo(map);
    marker.burst_marker = burst_marker;
    markers.push(burst_marker);

    var path_polyline = L.polyline(
        prediction_results.flight_path,
        { weight: 3, color: '#000000' }
    );

    if (i !== -1) {
        map.removeLayer(burst_marker); 
    } else {
        path_polyline.addTo(map); 
    }

    marker.flight_path = path_polyline;
    marker.burst_marker = burst_marker;

    marker.on('click', function(e) {
        if (map.hasLayer(marker.burst_marker)) {
            map.removeLayer(marker.burst_marker);
            if (map.hasLayer(marker.flight_path)) {
                map.removeLayer(marker.flight_path);
            }
        } else {
            map.addLayer(marker.burst_marker);
            map.addLayer(marker.flight_path);
        }
    });
}

// 個別マーカーのKMLをダウンロードする関数
function downloadSingleMarkerKML(marker) {
    var prediction = marker.prediction;
    var isCenter = marker.isCenter;
    var markerColor = marker.markerColor;
    var markerId = marker.markerId;
    
    // KMLファイルのヘッダー
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    kml += '<Document>\n';
    kml += '<name>WASA ' + (isCenter ? 'Central' : 'Sample') + ' Prediction</name>\n';
    kml += '<description>Balloon flight prediction</description>\n';
    
    // スタイルの定義
    kml += '<Style id="landingPoint">\n';
    kml += '  <IconStyle>\n';
    kml += '    <color>' + convertColorToKmlFormat(markerColor) + '</color>\n';
    kml += '    <scale>1.2</scale>\n';
    kml += '  </IconStyle>\n';
    kml += '</Style>\n';
    
    kml += '<Style id="flightPath">\n';
    kml += '  <LineStyle>\n';
    kml += '    <color>ff0000ff</color>\n';
    kml += '    <width>3</width>\n';
    kml += '</LineStyle>\n';
    kml += '</Style>\n';
    
    // 打ち上げ地点のプレースマーク
    var launch = prediction.launch;
    kml += '<Placemark>\n';
    kml += '  <name>Launch</name>\n';
    kml += '  <description>Launch location: ' + launch.latlng.lat.toFixed(6) + ', ' + launch.latlng.lng.toFixed(6) + '</description>\n';
    kml += '  <Point>\n';
    kml += '    <coordinates>' + launch.latlng.lng + ',' + launch.latlng.lat + ',' + launch.latlng.alt + '</coordinates>\n';
    kml += '  </Point>\n';
    kml += '</Placemark>\n';
    
    // バースト地点のプレースマーク
    var burst = prediction.burst;
    kml += '<Placemark>\n';
    kml += '  <name>Burst</name>\n';
    kml += '  <description>Burst location at altitude: ' + burst.latlng.alt.toFixed(0) + 'm</description>\n';
    kml += '  <Point>\n';
    kml += '    <coordinates>' + burst.latlng.lng + ',' + burst.latlng.lat + ',' + burst.latlng.alt + '</coordinates>\n';
    kml += '  </Point>\n';
    kml += '</Placemark>\n';
    
    // 着地地点のプレースマーク
    var landing = prediction.landing;
    kml += '<Placemark>\n';
    kml += '  <name>' + (isCenter ? 'Central Landing Point' : 'Sample Landing Point') + '</name>\n';
    kml += '  <styleUrl>#landingPoint</styleUrl>\n';
    kml += '  <description>Landing prediction: ' + landing.latlng.lat.toFixed(6) + ', ' + landing.latlng.lng.toFixed(6) + '</description>\n';
    kml += '  <Point>\n';
    kml += '    <coordinates>' + landing.latlng.lng + ',' + landing.latlng.lat + ',0</coordinates>\n';
    kml += '  </Point>\n';
    kml += '</Placemark>\n';
    
    // フライトパスのプレースマーク
    kml += '<Placemark>\n';
    kml += '  <name>Flight Path</name>\n';
    kml += '  <styleUrl>#flightPath</styleUrl>\n';
    kml += '  <LineString>\n';
    kml += '    <extrude>1</extrude>\n';
    kml += '    <tessellate>1</tessate>\n';
    kml += '    <altitudeMode>absolute</altitudeMode>\n';
    kml += '    <coordinates>\n';
    
    prediction.flight_path.forEach(function(point) {
        kml += '      ' + point[1] + ',' + point[0] + ',' + point[2] + '\n';
    });
    
    kml += '    </coordinates>\n';
    kml += '  </LineString>\n';
    kml += '</Placemark>\n';
    
    // KMLのフッター
    kml += '</Document>\n';
    kml += '</kml>';
    
    // ダウンロードファイル名の作成
    var filename = 'balloon_prediction_' + (isCenter ? 'central' : 'sample_' + markerId) + '_' + 
                   new Date().toISOString().split('T')[0] + '.kml';
    
    // KMLファイルのダウンロード
    downloadFile(kml, filename, 'application/vnd.google-earth.kml+xml');
}

// 個別マーカーのCSVをダウンロードする関数
function downloadSingleMarkerCSV(marker) {
    var prediction = marker.prediction;
    var isCenter = marker.isCenter;
    var markerId = marker.markerId;
    var ascent_diff = marker.ascent_diff;
    var burst_diff = marker.burst_diff;
    var descent_diff = marker.descent_diff;
    
    // CSVヘッダー
    var csv = 'Type,Time (UTC),Latitude,Longitude,Altitude (m)\n';
    
    // 打ち上げ、バースト、着地のポイント情報
    csv += 'Launch,' + prediction.launch.datetime.format() + ',' + 
           prediction.launch.latlng.lat.toFixed(6) + ',' + 
           prediction.launch.latlng.lng.toFixed(6) + ',' + 
           prediction.launch.latlng.alt.toFixed(1) + '\n';
           
    csv += 'Burst,' + prediction.burst.datetime.format() + ',' + 
           prediction.burst.latlng.lat.toFixed(6) + ',' + 
           prediction.burst.latlng.lng.toFixed(6) + ',' + 
           prediction.burst.latlng.alt.toFixed(1) + '\n';
           
    csv += 'Landing,' + prediction.landing.datetime.format() + ',' + 
           prediction.landing.latlng.lat.toFixed(6) + ',' + 
           prediction.landing.latlng.lng.toFixed(6) + ',0\n';
    
    // 空の行を追加
    csv += '\n';
    
    // フライトパスの詳細情報
    csv += 'Flight Path Points:\n';
    csv += 'Index,Latitude,Longitude,Altitude (m)\n';
    
    prediction.flight_path.forEach(function(point, index) {
        csv += index + ',' + point[0].toFixed(6) + ',' + point[1].toFixed(6) + ',' + point[2].toFixed(1) + '\n';
    });
    
    // Gaussian分布のパラメータ情報（サンプル点の場合）
    if (!isCenter) {
        csv += '\nGaussian Distribution Parameters:\n';
        csv += 'Ascent Rate Difference (σ),' + ascent_diff.toFixed(2) + '\n';
        csv += 'Burst Altitude Difference (σ),' + burst_diff.toFixed(2) + '\n';
        csv += 'Descent Rate Difference (σ),' + descent_diff.toFixed(2) + '\n';
    }
    
    // ダウンロードファイル名の作成
    var filename = 'balloon_prediction_' + (isCenter ? 'central' : 'sample_' + markerId) + '_' + 
                   new Date().toISOString().split('T')[0] + '.csv';
    
    // CSVファイルのダウンロード
    downloadFile(csv, filename, 'text/csv');
}

// ファイルをダウンロードする汎用関数
function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], {type: mimeType});
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// RGBカラーをKML形式に変換する関数
function convertColorToKmlFormat(colorStr) {
    // RGB形式 'rgb(255, 0, 0)' からKML形式 'ff0000ff' (ABGR)に変換
    if (colorStr.startsWith('rgb')) {
        var rgb = colorStr.match(/\d+/g);
        if (rgb && rgb.length === 3) {
            var r = parseInt(rgb[0]).toString(16).padStart(2, '0');
            var g = parseInt(rgb[1]).toString(16).padStart(2, '0');
            var b = parseInt(rgb[2]).toString(16).padStart(2, '0');
            return 'ff' + b + g + r; // KMLはABGR形式
        }
    }
    // 色が指定されていない場合のデフォルト
    return 'ff0000ff'; // 赤色 (ABGR)
}

function toDMS(deg) {
    var d = Math.floor(deg); // 度
    var minfloat = (deg - d) * 60;
    var m = Math.floor(minfloat); // 分
    var secfloat = (minfloat - m) * 60;
    var s = Math.round(secfloat); // 秒

    if (s === 60) {
        m++;
        s = 0;
    }

    if (m === 60) {
        d++;
        m = 0;
    }

    return d + "°" + m + "'" + s + "\"";
}

$(document).ready(function(){
    initCustomPlotUI();
});

// Track if time field has been manually changed
var customTimeLocked = false;

// Track custom point markers separately from prediction markers
var customPointMarkers = [];

// Add this function to check if the user is online
function isOnline() {
    return navigator.onLine;
}

function initCustomPlotUI(){
    // Create container with absolute positioning at the bottom-left
    let container = $('<div/>', {
        id: 'custom_plot',
        css: {
            position: 'absolute',
            bottom: '30px',
            left: '10px',
            padding: '10px',
            background: 'white',
            border: '1px solid #ccc',
            'z-index': 9999
        }
    }).appendTo('body');

    // Add title with online status indicator
    container.append('<b>Plot your own points</b> <span id="connection_status"></span><br/>');
    
    // Add form fields
    container.append('Lat: <input type="text" id="c_lat" size="7"/><br/>');
    container.append('Lon: <input type="text" id="c_lon" size="7"/><br/>');
    container.append('Alt: <input type="text" id="c_alt" size="7"/>(ｍ)<br/>');
    container.append('Time: <input type="text" id="c_time" size="14"/><br/>');
    container.append('<button id="plotBtn">Plot</button>');

    // Bind click
    $('#plotBtn').click(function(){
        plotCustomPoint();
    });

    // Initialize with the current time
    updateCustomTime();
    
    // Add event listener to detect manual changes
    $('#c_time').on('input', function() {
        customTimeLocked = true;
    });
    
    // Update time every second if not manually changed
    setInterval(function() {
        if (!customTimeLocked) {
            updateCustomTime();
        }
    }, 1000);

    // Update connection status
    updateConnectionStatus();
    
    // Listen for online/offline events
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    
    // Check periodically for connection changes
    setInterval(updateConnectionStatus, 5000);

    var mainYear = parseInt($('#year').val());
    var mainMonth = parseInt($('#month').val());
    var mainDay = parseInt($('#day').val());
    var mainHour = parseInt($('#hour').val());
    var mainMin = parseInt($('#min').val());
    if(!isNaN(mainYear) && !isNaN(mainMonth) && !isNaN(mainDay) && !isNaN(mainHour) && !isNaN(mainMin)){
        var defaultTime = moment.utc([mainYear, mainMonth - 1, mainDay, mainHour, mainMin, 0, 0]);
        $('#c_time').val(defaultTime.format("YYYY-MM-DD HH:mm:ss"));
    }
}

// Function to update connection status display
function updateConnectionStatus() {
    var online = isOnline();
    if (online) {
        $('#connection_status').html('<span style="color: green;">[オンライン]</span>');
    } else {
        $('#connection_status').html('<span style="color: #FF6600;">[オフライン]</span>');
    }
    
    // For any existing custom point popups, update their status
    customPointMarkers.forEach(function(marker) {
        if (marker.isPopupOpen()) {
            var popup = marker.getPopup();
            var $content = $(popup._contentNode);
            var $predictBtn = $content.find('.predict-btn');
            
            if (online) {
                $predictBtn.prop('disabled', false).css({
                    'opacity': '1',
                    'cursor': 'pointer'
                }).removeAttr('title');
                $content.find('.offline-warning').remove();
            } else {
                $predictBtn.prop('disabled', true).css({
                    'opacity': '0.5',
                    'cursor': 'not-allowed'
                }).attr('title', 'オフライン時は予測機能を使用できません');
                
                if ($content.find('.offline-warning').length === 0) {
                    $content.find('p').after(
                        "<div class='offline-warning' style='color: #FF6600; margin-bottom: 8px; font-weight: bold;'>" +
                        "⚠️ オフラインモード: 予測機能は使用できません</div>"
                    );
                }
            }
        }
    });
}

function updateCustomTime() {
    // Match the behavior of the updateTime() function in index.html
    const urlParams = new URLSearchParams(window.location.search);
    const launchDatetime = urlParams.get('launch_datetime');
    
    let now;
    if (launchDatetime && launchDatetime !== 'now') {
        // Get the time from URL and advance by 8 hours to match MST
        now = new Date(launchDatetime);
        now.setHours(now.getHours() + 8);
    } else {
        // Otherwise use current time
        now = new Date();
    }
    
    // Format the date to YYYY-MM-DD HH:mm:ss format
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    $('#c_time').val(`${year}-${month}-${day} ${hours}:${minutes}:${seconds}`);
}

function plotCustomPoint(){
    // Get values
    let lat = parseFloat($('#c_lat').val());
    let lon = parseFloat($('#c_lon').val());
    let alt = parseFloat($('#c_alt').val() || 0);
    let time = $('#c_time').val();

    if(isNaN(lat) || isNaN(lon)){
        alert('Invalid Lat/Lon!');
        return;
    }

    // Place marker
    let marker = L.marker([lat, lon], {
        title: 'Custom Point: ' + alt + 'm at ' + time
    }).addTo(map);

    // Check online status to determine popup content
    let online = isOnline();
    
    // Create popup content with buttons
    // If offline, show warning and disable predict button
    let popupContent = 
        "<div>" +
        "<p><b>Altitude:</b> " + alt + "m<br/>" +
        "<b>Time:</b> " + time + "</p>";
        
    if (!online) {
        popupContent += "<div style='color: #FF6600; margin-bottom: 8px; font-weight: bold;'>⚠️ オフラインモード: 予測機能は使用できません</div>";
        popupContent += "<button class='predict-btn' disabled style='opacity: 0.5; cursor: not-allowed;' title='オフライン時は予測機能を使用できません'>Predict from here</button> ";
    } else {
        popupContent += "<button class='predict-btn'>Predict from here</button> ";
    }
    
    popupContent += "<button class='delete-btn'>Delete point</button>" +
        "</div>";
    
    // Create and bind popup
    let popup = L.popup().setContent(popupContent);
    marker.bindPopup(popup);
    
    // Store marker data
    marker.customData = {
        lat: lat,
        lon: lon,
        alt: alt,
        time: time
    };
    
    // Add to custom markers collection
    customPointMarkers.push(marker);
    
    // Add event listeners after popup is opened
    marker.on('popupopen', function() {
        // Update online status each time popup is opened
        let currentlyOnline = isOnline();
        
        // Predict button should only work if online
        if (currentlyOnline) {
            $('.predict-btn').click(function() {
                runCustomPointPrediction(marker);
            });
        } else {
            // If the user is offline but the popup was created when online
            // Update the button state to reflect current status
            if (!$('.predict-btn').prop('disabled')) {
                $('.predict-btn').prop('disabled', true).css({
                    'opacity': '0.5',
                    'cursor': 'not-allowed'
                }).attr('title', 'オフライン時は予測機能を使用できません');
                
                // Add warning if it doesn't exist yet
                if ($('.offline-warning').length === 0) {
                    $(popup._contentNode).find('p').after(
                        "<div class='offline-warning' style='color: #FF6600; margin-bottom: 8px; font-weight: bold;'>" +
                        "⚠️ オフラインモード: 予測機能は使用できません</div>"
                    );
                }
            }
        }
        
        // Delete button works regardless of connection status
        $('.delete-btn').click(function() {
            deleteCustomPoint(marker);
        });
    });

    // Optionally pan/zoom to the new marker
    map.setView([lat, lon], 10);

    appendDebug('Plotted custom point at: ' + lat + ', ' + lon + ' alt:' + alt + ' time:' + time + 
                (online ? '' : ' (offline mode)'));
}

function deleteCustomPoint(marker) {
    // First, remove any associated prediction
    if (marker.customPrediction) {
        removeCustomPrediction(marker);
    }
    
    // Remove marker from map
    map.removeLayer(marker);
    
    // Remove from array
    let index = customPointMarkers.indexOf(marker);
    if (index > -1) {
        customPointMarkers.splice(index, 1);
    }
    
    appendDebug('Deleted custom point and any associated prediction');
}

function runCustomPointPrediction(marker) {
    // Double-check online status before attempting prediction
    if (!isOnline()) {
        alert('オフライン時は予測機能を使用できません。インターネット接続を確認してください。');
        return;
    }
    
    // Get settings from the marker
    let customLat = marker.customData.lat;
    let customLon = marker.customData.lon;
    let customAlt = marker.customData.alt;
    
    // Parse the time from the marker
    let customTimeStr = marker.customData.time;
    let customTime;
    
    try {
        // Try to parse the time string to a moment object - use specific format
        customTime = moment(customTimeStr, "YYYY-MM-DD HH:mm:ss");
        if (!customTime.isValid()) {
            throw new Error("Invalid time format");
        }
        
        // Make sure we're working with UTC time to match the main prediction
        customTime = moment.utc(customTime);
        
    } catch (e) {
        alert("Invalid time format. Using current time instead.");
        customTime = moment.utc(); // Make sure to use UTC
    }
    
    // Create settings object (similar to main prediction)
    let run_settings = {};
    let extra_settings = {};
    
    // Get flight profile and other settings from main form
    run_settings.profile = $('#flight_profile').val();
    run_settings.pred_type = 'single'; // Always do single prediction for custom points
    
    // Use custom launch parameters
    run_settings.launch_latitude = customLat;
    run_settings.launch_longitude = customLon;
    // Handle negative longitudes - Tawhiri wants longitudes between 0-360
    if (run_settings.launch_longitude < 0.0) {
        run_settings.launch_longitude += 360.0;
    }
    run_settings.launch_altitude = customAlt;
    
    // Get other settings from main form
    run_settings.ascent_rate = parseFloat($('#ascent').val());

    // Build date components - similar to how the main prediction does it
    let year = customTime.year();
    let month = customTime.month(); // month is zero-indexed in moment.js
    let day = customTime.date();
    let hour = customTime.hours();
    let minute = customTime.minutes();

    // Create a proper UTC time using the same approach as the main prediction
    let launch_time = moment.utc([year, month, day, hour, minute, 0, 0]).subtract(8, 'hours');
    run_settings.launch_datetime = launch_time.format();
    extra_settings.launch_moment = launch_time;
    
    if (run_settings.profile == "standard_profile") {
        run_settings.burst_altitude = parseFloat($('#burst').val());
        run_settings.descent_rate = parseFloat($('#drag').val());
    } else {
        run_settings.float_altitude = parseFloat($('#burst').val());
        run_settings.stop_datetime = moment(launch_time).add(1, 'days').format();
    }
    
    // Run custom prediction
    appendDebug('Running prediction from custom point: ' + customLat + ', ' + customLon + ' at ' + run_settings.launch_datetime);
    customPointPredictionRequest(run_settings, extra_settings, marker);
}

function customPointPredictionRequest(settings, extra_settings, sourceMarker) {
    $.get(tawhiri_api, settings)
        .done(function(data) {
            processCustomPointPrediction(data, settings, sourceMarker);
        })
        .fail(function(data) {
            var prediction_error = "Custom point prediction failed. Tawhiri may be under heavy load, please try again.";
            if(data.hasOwnProperty("responseJSON")) {
                prediction_error += data.responseJSON.error.description;
            }
            alert(prediction_error);
        });
}

function processCustomPointPrediction(data, settings, sourceMarker) {
    if(data.hasOwnProperty('error')){
        alert("Custom point predictor returned error: " + data.error.description);
        return;
    }
    
    var prediction_results = parsePrediction(data.prediction);
    plotCustomPointPrediction(prediction_results, sourceMarker);
}

function plotCustomPointPrediction(prediction, sourceMarker) {
    var launch = prediction.launch;
    var landing = prediction.landing;
    var burst = prediction.burst;

    // Create markers with different styling for custom prediction
    var customLaunchIcon = L.icon({
        iconUrl: launch_img,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });

    var customLandIcon = L.icon({
        iconUrl: land_img,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
    });

    var customBurstIcon = L.icon({
        iconUrl: burst_img,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    // Create custom path with different color
    var customPathPolyline = L.polyline(
        prediction.flight_path,
        {
            weight: 3,
            color: '#0000FF', // Blue line for custom prediction
            opacity: 0.7
        }
    ).addTo(map);
    
    // Add markers
    var customLandMarker = L.marker(
        landing.latlng,
        {
            title: 'Custom Predicted Landing (' + landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4) + ') at ' 
            + landing.datetime.format("HH:mm") + " UTC",
            icon: customLandIcon
        }
    ).addTo(map);
    
    var customBurstMarker = L.marker(
        burst.latlng,
        {
            title: 'Custom Burst Point (' + burst.latlng.lat.toFixed(4) + ', ' + burst.latlng.lng.toFixed(4) + 
            ' at altitude ' + burst.latlng.alt.toFixed(0) + ') at ' 
            + burst.datetime.format("HH:mm") + " UTC",
            icon: customBurstIcon
        }
    ).addTo(map);
    
    // Create and add popup to land marker
    var landPopupContent = 
        "<div>" +
        "<p><b>Custom Prediction</b><br/>" +
        "Landing: " + landing.latlng.lat.toFixed(4) + ", " + landing.latlng.lng.toFixed(4) + "<br/>" +
        "Time: " + landing.datetime.format("YYYY-MM-DD HH:mm:ss") + "<br/>" +
        "Flight duration: " + formatFlightTime(prediction.flight_time) + "</p>" +
        "<button class='remove-prediction-btn'>Remove prediction</button>" +
        "</div>";
    
    customLandMarker.bindPopup(landPopupContent);
    
    // Store all elements for later removal
    sourceMarker.customPrediction = {
        path: customPathPolyline,
        landMarker: customLandMarker,
        burstMarker: customBurstMarker
    };
    
    // Add event listener for removing prediction
    customLandMarker.on('popupopen', function() {
        $('.remove-prediction-btn').click(function() {
            removeCustomPrediction(sourceMarker);
        });
    });
    
    // Pan to show both the source and landing
    var bounds = L.latLngBounds(
        [sourceMarker.getLatLng(), landing.latlng, burst.latlng]
    );
    map.fitBounds(bounds);
    
    appendDebug('Custom prediction completed. Landing at: ' + landing.latlng.lat.toFixed(4) + ', ' + landing.latlng.lng.toFixed(4));
}

function removeCustomPrediction(sourceMarker) {
    if (sourceMarker.customPrediction) {
        map.removeLayer(sourceMarker.customPrediction.path);
        map.removeLayer(sourceMarker.customPrediction.landMarker);
        map.removeLayer(sourceMarker.customPrediction.burstMarker);
        
        delete sourceMarker.customPrediction;
        appendDebug('Custom prediction removed');
    }
}

function formatFlightTime(seconds) {
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;
    
    return hours + "hr " + minutes + "min " + secs + "sec";
}

function plotWeibullDistribution(settings, extra_settings) {
    var ascent_rate = parseFloat($('#ascent').val());
    var burst_altitude = parseFloat($('#burst').val());
    var descent_rate = parseFloat($('#drag').val());

    clearMarkers();

    // Settings for Weibull distribution
    var shape = 3.0; // Shape parameter k > 1 indicates increasing failure rate with time/altitude
    var scale = burst_altitude; // Scale parameter λ (lambda)

    // Store all landing points for KML/CSV export
    var all_landing_points = [];
    var all_prediction_results = [];
    var completedRequests = 0;
    var totalRequests = 101; // 100 samples + 1 central point
    var burst_altitudes = [];

    // Generate Weibull distributed values for burst altitude
    // We'll use shape and scale to generate values around the target burst altitude
    for (var i = 0; i < 100; i++) {
        var burst_sample = weibullRandom(shape, scale);
        burst_altitudes.push(burst_sample);
    }

    // Central landing point (mean values)
    var centralSettings = { ...settings };
    centralSettings.ascent_rate = ascent_rate;
    centralSettings.burst_altitude = burst_altitude;
    centralSettings.descent_rate = descent_rate;

    var central_point = null;
    $.get(tawhiri_api, centralSettings)
        .done(function (data) {
            central_point = parsePrediction(data.prediction).landing.latlng;

            var central_prediction_results = parsePrediction(data.prediction);
            all_prediction_results.push({
                result: central_prediction_results,
                color: 'red',
                isCentral: true,
                ascent: ascent_rate,
                burst: burst_altitude,
                descent: descent_rate
            });
            all_landing_points.push({
                latlng: central_point,
                color: 'red',
                isCentral: true,
                ascent: ascent_rate,
                burst: burst_altitude,
                descent: descent_rate
            });
            
            // For central point, use special flag to indicate Weibull distribution
            plotMultiplePredictionWithColor(central_prediction_results, -1, 'red', 0, 0, 0, true);
            completedRequests++;

            // Plot the distributions on the map
            var landing_points = [];
            for (let i = 0; i < burst_altitudes.length; i++) {
                var settings_copy = { ...settings };
                settings_copy.ascent_rate = ascent_rate; // Keep ascent rate constant
                settings_copy.burst_altitude = burst_altitudes[i];
                settings_copy.descent_rate = descent_rate; // Keep descent rate constant
            
                // Run the prediction for each sample
                $.get(tawhiri_api, settings_copy)
                    .done(function (data) {
                        var prediction_results = parsePrediction(data.prediction);
                        var landing_point = prediction_results.landing.latlng;
                        landing_points.push(landing_point);
            
                        // Calculate how far this sample is from the target burst altitude
                        // Calculate percentage difference rather than a normalized value
                        var burst_percentage_diff = ((burst_altitudes[i] - burst_altitude) / burst_altitude) * 100;
                        var burst_diff = Math.abs(burst_percentage_diff) / 20; // Scale to 0-1 range (assuming max 20% diff)
                        burst_diff = Math.min(burst_diff, 1.0); // Clamp to 1.0 max
                        
                        // Map distance to a color
                        var color = burstDiffToColor(burst_diff);
                        
                        // Store for export
                        all_prediction_results.push({
                            result: prediction_results,
                            color: color,
                            isCentral: false,
                            ascent: ascent_rate,
                            burst: burst_altitudes[i],
                            descent: descent_rate,
                            burst_percentage_diff: burst_percentage_diff
                        });
                        all_landing_points.push({
                            latlng: landing_point,
                            color: color,
                            isCentral: false,
                            ascent: ascent_rate,
                            burst: burst_altitudes[i],
                            descent: descent_rate,
                            burst_percentage_diff: burst_percentage_diff
                        });
                        
                        // Plot each prediction with Weibull flag and percentage difference
                        plotMultiplePredictionWithColor(prediction_results, i, color, 0, burst_percentage_diff, 0, true);
                        
                        completedRequests++;
                        
                        // When all predictions are complete, enable download buttons
                        if (completedRequests >= totalRequests) {
                            enableWeibullDownloads(all_landing_points, all_prediction_results);
                        }
                    })
                    .fail(function (data) {
                        console.error("Prediction failed for Weibull sample");
                        completedRequests++;
                        
                        // Even if some fail, enable downloads when all requests are processed
                        if (completedRequests >= totalRequests) {
                            enableWeibullDownloads(all_landing_points, all_prediction_results);
                        }
                    });
            }
        })
        .fail(function (data) {
            console.error("Central point prediction failed");
            completedRequests++;
        });
}

// Generate a random value from Weibull distribution
function weibullRandom(shape, scale) {
    // Generate a uniform random number between 0 and 1
    var u = Math.random();
    
    // Apply inverse CDF of Weibull distribution
    // F^(-1)(u) = λ * (-ln(1-u))^(1/k)
    // For numerical stability, we can use -ln(u) instead of -ln(1-u)
    var x = scale * Math.pow(-Math.log(u), 1/shape);
    
    return x;
}

// Convert burst altitude difference to a color
function burstDiffToColor(burst_diff) {
    // Create a color that transitions from green (low diff) to red (high diff)
    var red = Math.round(255 * burst_diff);
    var green = Math.round(255 * (1 - burst_diff));
    var blue = 0;
    
    return 'rgb(' + red + ',' + green + ',' + blue + ')';
}

// Add downloads for Weibull distribution
function enableWeibullDownloads(landingPoints, predictionResults) {
    // First clean up any existing download buttons
    $('#weibull-download-container').remove();
    
    // Add download buttons in same style and location as other prediction types
    var container = $('<div id="weibull-download-container" class="panel-body"></div>');
    
    var kmlBtn = $('<a id="weibull-download-kml" class="btn btn-default">Download KML</a>');
    var csvBtn = $('<a id="weibull-download-csv" class="btn btn-default">Download CSV</a>');
    
    container.append(kmlBtn).append(' ').append(csvBtn);
    
    // Insert the container at the same location as other downloads
    $('#downloads').append(container);
    
    // Add click handlers
    $('#weibull-download-kml').off('click').on('click', function(e) {
        e.preventDefault();
        downloadWeibullKML(landingPoints, predictionResults);
    });
    
    $('#weibull-download-csv').off('click').on('click', function(e) {
        e.preventDefault();
        downloadWeibullCSV(landingPoints, predictionResults);
    });
    
    // Show the download section if it was hidden
    $('#downloads').show();
}

function downloadWeibullKML(landingPoints, predictionResults) {
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    kml += '<Document>\n';
    kml += '<name>WASA Weibull Distribution Prediction</name>\n';
    
    // Add style for central point
    kml += '<Style id="centralPoint">\n';
    kml += '  <IconStyle>\n';
    kml += '    <color>ff0000ff</color>\n';
    kml += '    <scale>1.2</scale>\n';
    kml += '  </IconStyle>\n';
    kml += '</Style>\n';
    
    // Add style for other points
    kml += '<Style id="samplePoint">\n';
    kml += '  <IconStyle>\n';
    kml += '    <scale>0.8</scale>\n';
    kml += '  </IconStyle>\n';
    kml += '</Style>\n';
    
    // Add points
    landingPoints.forEach(function(point, index) {
        var styleUrl = point.isCentral ? "#centralPoint" : "#samplePoint";
        var name = point.isCentral ? "Central Landing Point" : "Sample Landing Point " + index;
        var description = "Burst Altitude: " + point.burst.toFixed(2) + " m<br/>" +
                         "Ascent Rate: " + point.ascent.toFixed(2) + " m/s<br/>" +
                         "Descent Rate: " + point.descent.toFixed(2) + " m/s";
        
        kml += '<Placemark>\n';
        kml += '  <name>' + name + '</name>\n';
        kml += '  <description><![CDATA[' + description + ']]></description>\n';
        kml += '  <styleUrl>' + styleUrl + '</styleUrl>\n';
        kml += '  <Point>\n';
        kml += '    <coordinates>' + point.latlng.lng + ',' + point.latlng.lat + ',0</coordinates>\n';
        kml += '  </Point>\n';
        kml += '</Placemark>\n';
    });
    
    kml += '</Document>\n';
    kml += '</kml>';
    
    // Create download link
    var blob = new Blob([kml], {type: 'application/vnd.google-earth.kml+xml'});
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'weibull_prediction_' + new Date().toISOString().split('T')[0] + '.kml';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}

function downloadWeibullCSV(landingPoints, predictionResults) {
    var csv = 'Type,Latitude,Longitude,Ascent Rate (m/s),Burst Altitude (m),Burst Altitude Difference (%),Descent Rate (m/s),Color\n';
    
    landingPoints.forEach(function(point) {
        var type = point.isCentral ? "Central" : "Sample";
        var burst_diff_pct = point.burst_percentage_diff || 0;
        
        csv += type + ',' +
               point.latlng.lat.toFixed(6) + ',' +
               point.latlng.lng.toFixed(6) + ',' +
               point.ascent.toFixed(2) + ',' +
               point.burst.toFixed(2) + ',' +
               burst_diff_pct.toFixed(2) + ',' +
               point.descent.toFixed(2) + ',' +
               point.color + '\n';
    });
    
    // Create download link
    var blob = new Blob([csv], {type: 'text/csv'});
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'weibull_prediction_' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}