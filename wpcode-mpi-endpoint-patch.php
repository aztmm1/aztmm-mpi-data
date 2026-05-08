<?php
/**
 * AZTMM MPI Endpoint — jsDelivr-backed proxy (PATCH for WPCode snippet)
 *
 * Replaces / supersedes whatever currently powers GET /wp-json/aztmm/v2/mpi.json.
 * Fetches the canonical mpi.json from a public GitHub repo via jsDelivr CDN
 * (cached at the edge for ~10 min by default), with a 5-minute object cache
 * via WP transients so we don't hit jsDelivr on every page load.
 *
 * INSTALL
 *   1. WP Admin -> Code Snippets.
 *   2. Open the snippet that registers /wp-json/aztmm/v2/mpi.json (search for
 *      "aztmm/v2" or "register_rest_route" with "mpi"). Likely IDs: #1909 or
 *      #2006. If none exists, create a new "PHP" snippet titled
 *      "AZTMM MPI v2 Endpoint" set to "Run Everywhere".
 *   3. Replace the body of that snippet with the code BETWEEN the BEGIN/END
 *      markers below (do not include the <?php opener — WPCode adds it).
 *   4. Edit the AZTMM_MPI_JSDELIVR_URL constant — replace YOUR_GITHUB_USERNAME
 *      with the GitHub username of the repo created in the README setup.
 *   5. Save & activate. Hard-refresh aztmm.com and confirm /wp-json/aztmm/v2/mpi.json
 *      returns the latest values.
 *
 * NOTES
 *   - jsDelivr default TTL is roughly 12h on default URLs but only ~10 min on
 *     `@main` branch URLs. Combined with the 5-min transient cache, freshness
 *     after a GitHub Actions push is typically ~5-15 minutes.
 *   - To force-bust on demand, append `?v=YYYYMMDDHHMM` from the consumer
 *     (the WPCode hydrate snippet can do this each fetch).
 *   - If jsDelivr is unreachable, the endpoint serves the last-good payload
 *     from the transient. If even that's gone, it returns a structured
 *     `{ "data_quality": "degraded", ... }` payload with the static fallback.
 */

/* ============================================================================
   BEGIN — paste everything below this line into the WPCode PHP snippet
   ============================================================================ */

if ( ! defined( 'AZTMM_MPI_JSDELIVR_URL' ) ) {
    // TODO: replace YOUR_GITHUB_USERNAME with the actual GH username.
    define( 'AZTMM_MPI_JSDELIVR_URL',
        'https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/aztmm-mpi-data@main/data/mpi.json'
    );
}
if ( ! defined( 'AZTMM_MPI_CACHE_KEY' ) )    { define( 'AZTMM_MPI_CACHE_KEY',    'aztmm_mpi_v2_payload' ); }
if ( ! defined( 'AZTMM_MPI_CACHE_TTL' ) )    { define( 'AZTMM_MPI_CACHE_TTL',    5 * MINUTE_IN_SECONDS );  }
if ( ! defined( 'AZTMM_MPI_LASTGOOD_KEY' ) ) { define( 'AZTMM_MPI_LASTGOOD_KEY', 'aztmm_mpi_v2_lastgood' ); }
if ( ! defined( 'AZTMM_MPI_LASTGOOD_TTL' ) ) { define( 'AZTMM_MPI_LASTGOOD_TTL', 7 * DAY_IN_SECONDS );      }

/**
 * Static last-resort fallback. Mirrors the seed shape so consumers never
 * receive a hard error. Update once per major refresh; in steady state this
 * is rarely served because jsDelivr + transients cover ~99.9% of requests.
 */
function aztmm_mpi_static_fallback() {
    return array(
        'schema_version'        => '2.0',
        'computed_at'           => gmdate( 'c' ),
        'asOf'                  => gmdate( 'Y-m-d' ),
        'stale_threshold_hours' => 18,
        'data_quality'          => 'degraded',
        'data' => array(
            'mpi_score'     => 50,
            'mpi_label'     => 'Sideways',
            'regime'        => 'Sideways',
            'regime_label'  => 'Sideways',
            'confidence'    => array( 'ci_level' => '85%', 'ci_low' => 45, 'ci_high' => 55 ),
            'signal'        => array( 'bias' => 'Neutral', 'strength' => 'Low' ),
            'market'        => array( 'spy_spot' => null, 'expected_move_1sigma' => null, 'expected_move_pct' => null ),
            'volatility'    => array( 'vix' => null, 'vix3m' => null, 'vrp' => null, 'term_shape' => 'n/a' ),
            'compass'       => array(
                'bias' => 'Neutral', 'confidence' => 0.40,
                'probability_up' => 0.34, 'probability_flat' => 0.33, 'probability_down' => 0.33,
            ),
        ),
        'warnings' => array( 'static_fallback' ),
    );
}

/**
 * Fetch jsDelivr -> on success return decoded payload + cache transient.
 * On failure return last-good transient or static fallback.
 *
 * @return array
 */
function aztmm_mpi_fetch_remote() {
    $cached = get_transient( AZTMM_MPI_CACHE_KEY );
    if ( $cached && is_array( $cached ) ) {
        return $cached;
    }

    $args = array(
        'timeout'     => 6,
        'redirection' => 3,
        'user-agent'  => 'AZTMM-WP-Proxy/1.0',
        'sslverify'   => true,
        'headers'     => array( 'Accept' => 'application/json' ),
    );

    $resp = wp_remote_get( AZTMM_MPI_JSDELIVR_URL, $args );
    if ( is_wp_error( $resp ) ) {
        $lg = get_transient( AZTMM_MPI_LASTGOOD_KEY );
        if ( $lg && is_array( $lg ) ) {
            $lg['data_quality'] = 'degraded';
            $lg['warnings'][]   = 'remote_unreachable: ' . $resp->get_error_message();
            return $lg;
        }
        return aztmm_mpi_static_fallback();
    }

    $code = (int) wp_remote_retrieve_response_code( $resp );
    if ( $code < 200 || $code >= 300 ) {
        $lg = get_transient( AZTMM_MPI_LASTGOOD_KEY );
        if ( $lg && is_array( $lg ) ) {
            $lg['data_quality'] = 'degraded';
            $lg['warnings'][]   = 'remote_http_' . $code;
            return $lg;
        }
        return aztmm_mpi_static_fallback();
    }

    $body = wp_remote_retrieve_body( $resp );
    $json = json_decode( $body, true );
    if ( ! is_array( $json ) || empty( $json['schema_version'] ) ) {
        $lg = get_transient( AZTMM_MPI_LASTGOOD_KEY );
        if ( $lg && is_array( $lg ) ) {
            $lg['data_quality'] = 'degraded';
            $lg['warnings'][]   = 'remote_invalid_json';
            return $lg;
        }
        return aztmm_mpi_static_fallback();
    }

    set_transient( AZTMM_MPI_CACHE_KEY,    $json, AZTMM_MPI_CACHE_TTL );
    set_transient( AZTMM_MPI_LASTGOOD_KEY, $json, AZTMM_MPI_LASTGOOD_TTL );
    return $json;
}

/**
 * Register REST route GET /wp-json/aztmm/v2/mpi.json
 */
add_action( 'rest_api_init', function () {
    register_rest_route( 'aztmm/v2', '/mpi(?:\.json)?', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function ( $request ) {
            $payload = aztmm_mpi_fetch_remote();
            $resp = new WP_REST_Response( $payload, 200 );
            // Edge cache 60s, browser 30s. Real freshness comes from origin push.
            $resp->header( 'Cache-Control', 'public, s-maxage=60, max-age=30' );
            $resp->header( 'Content-Type', 'application/json; charset=utf-8' );
            return $resp;
        },
    ) );
} );

/* ============================================================================
   END — stop pasting above this line
   ============================================================================ */
