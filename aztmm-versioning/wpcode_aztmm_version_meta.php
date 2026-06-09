<?php
/**
 * AZTMM Version Metadata Registration
 * -------------------------------------------------------------------
 * WPCode snippet — register the `aztmm_*` custom post meta keys so the
 * REST API will accept writes from publish_to_wp.py and detect_corrections.py.
 *
 * `show_in_rest` is set BUT with `auth_callback` requiring `edit_posts`,
 * which means anonymous public requests cannot read the meta values
 * (satisfies the "don't expose version metadata publicly" constraint).
 *
 * Snippet ID:    next available (target #2008 by convention)
 * Run on:        all pages, init hook
 * Category:      pipeline / publish
 * Description:   Registers aztmm_version_id, aztmm_content_hash,
 *                aztmm_payload_hash, aztmm_published_at,
 *                aztmm_quality_gate_passed, aztmm_publish_run_id,
 *                aztmm_last_correction_at, aztmm_last_correction_materiality
 *
 * IMPORTANT: Without this snippet, WP REST silently drops the `meta` field
 * from POST/PATCH bodies. Test with:
 *   curl -u user:pw 'https://aztmm.com/wp-json/wp/v2/posts/2879?context=edit&_fields=id,meta'
 * After registration, `meta` block will include the aztmm_* keys.
 */

add_action( 'init', function () {
    $keys = [
        'aztmm_version_id',
        'aztmm_content_hash',
        'aztmm_payload_hash',
        'aztmm_published_at',
        'aztmm_quality_gate_passed',
        'aztmm_publish_run_id',
        'aztmm_last_correction_at',
        'aztmm_last_correction_materiality',
    ];

    foreach ( $keys as $key ) {
        register_post_meta( 'post', $key, [
            'type'              => 'string',
            'single'            => true,
            'show_in_rest'      => [
                // Restrict the REST surface so only edit_posts users can read/write.
                // The values are never embedded into rendered HTML output by themes,
                // and `context=edit` requires authentication, so they stay private.
                'schema' => [
                    'type'    => 'string',
                    'context' => [ 'edit' ],   // hide from public 'view' context
                ],
            ],
            'auth_callback'     => function () { return current_user_can( 'edit_posts' ); },
            'sanitize_callback' => 'sanitize_text_field',
        ] );
    }
} );
